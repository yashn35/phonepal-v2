const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const multer = require('multer');
const FormData = require('form-data');
const fetch = require('node-fetch');
const cors = require('cors');
const groq = require('groq-sdk');
const humanId = require('human-id'); // Human friendly caller ID 

const next = require('next');
const dev = process.env.NODE_ENV !== 'production';
const nextApp = next({ dev });
const nextHandler = nextApp.getRequestHandler();

nextApp.prepare().then(() => {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server });

  app.use(cors({
    origin: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));

  const upload = multer({ storage: multer.memoryStorage() });

  require('dotenv').config({ path: '.env.local' });
  const groqClient = new groq.Groq({ apiKey: process.env.GROQ_API_KEY });

  // const clients = new Map();
  const calls = new Map(); 
  const clientLanguages = new Map();

  wss.on('connection', (ws) => {
    
    const clientId = Date.now().toString();
    // clients.set(clientId, { ws, language: null, voiceId: null });
    console.log("THIS IS A CLIENT ID", clientId)
    clientLanguages.set(clientId, 'en');

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        
        if (data.type === 'createCall') {
          const callId = humanId.humanId({
            separator: '-',
            capitalize: false
          });
          calls.set(callId, new Set([ws]));
          ws.callId = callId;
          ws.send(JSON.stringify({ type: 'callCreated', callId }));
        } else if (data.type === 'joinCall') {
          const { callId } = data;
          if (calls.has(callId)) {
            calls.get(callId).add(ws);
            ws.callId = callId;
            ws.send(JSON.stringify({ type: 'callJoined', callId }));
          } else {
            ws.send(JSON.stringify({ type: 'error', message: 'Call not found' }));
          }
        } else if (data.type === 'language') {
          ws.language = data.language;
          // clients.get(clientId).language = data.language;
          clientLanguages.set(clientId, data.language);
          broadcastLanguage(ws);
          console.log(`Language updated for client ${clientId} in call ${ws.callId}: ${data.language}`);
        } else if (data.type === 'voiceId') {
          ws.voiceId = data.voiceId;
        }
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    });

    ws.on('close', () => {
      if (ws.callId && calls.has(ws.callId)) {
        calls.get(ws.callId).delete(ws);
        if (calls.get(ws.callId).size === 0) {
          calls.delete(ws.callId);
        }
      }
      clientLanguages.delete(ws.clientId);
    });
  });

  function broadcastLanguage(sender) {
    if (sender.callId && calls.has(sender.callId)) {
      console.log(`Broadcasting language update in call ${sender.callId}`);
      calls.get(sender.callId).forEach(currentClient => {
        console.log("sender", sender.callId)
        console.log("client", currentClient.callId)
        if (currentClient !== sender && currentClient.readyState === WebSocket.OPEN) {
          currentClient.send(JSON.stringify({
            type: 'language',
            language: sender.language
          }));
        }
      });
    }
  }

  app.post('/process-audio', upload.single('audio'), async (req, res) => {
    try {
      const voiceId = req.body.voiceId || "a0e99841-438c-4a64-b679-ae501e7d6091";
      const receiverLanguage = req.body.receiverLanguage;
      const callId = req.body.callId;
      
      // TODO: Let's time this to see how long each step takes 
      const transcription = await getTranscript(req);
      console.log("TRANSCRIPTION", transcription)
      const translation = await translateText(transcription, receiverLanguage);
      console.log("TRANSLATION", translation)
      const audioBuffer = await generateAudio(translation, voiceId, receiverLanguage);
      console.log("AUDIO GENERATED", audioBuffer)
      
      if (calls.has(callId)) {
        calls.get(callId).forEach(client => {
          console.log("-----------------------------------")
          console.log("callID", callId)
          console.log(client.language === receiverLanguage)
          console.log(client.language)
          console.log("senderLanguage", req.body.senderLanguage)
          console.log("receiverLanguage", receiverLanguage)
          console.log("-----------------------------------")

          /* TODO: 
          We can check for this based on the caller ID instead of if the languages are the same, because the sender and reciever may have the same language choice. 
          Moreover, if the sender and reciever do have the same language choice then we should just send the raw audio data instead of going through the translation process. 
          */
          if (client.readyState === WebSocket.OPEN && client.language === receiverLanguage) {
            client.send(audioBuffer, { binary: true });
          }
        });
      }
      
      res.status(200).json({ success: true });
    } catch (error) {
      console.error('Error processing audio:', error);
      res.status(500).json({ error: 'Failed to process audio' });
    }
  });

  app.post('/clone-voice', upload.single('voiceSample'), async (req, res) => {
    try {
      const form = new FormData();
      form.append('clip', req.file.buffer, {
        filename: 'voice_sample.wav',
        contentType: req.file.mimetype,
      });

      // Clone the voice
      const cloneResponse = await fetch('https://api.cartesia.ai/voices/clone/clip', {
        method: 'POST',
        headers: {
          'Cartesia-Version': '2024-06-10',
          'X-API-Key': process.env.CARTESIA_API_KEY,
          ...form.getHeaders()
        },
        body: form
      });

      if (!cloneResponse.ok) {
        throw new Error(`Failed to clone voice: ${await cloneResponse.text()}`);
      }

      const clonedVoice = await cloneResponse.json();

      // Create a voice with the embedding
      const createVoiceResponse = await fetch('https://api.cartesia.ai/voices', {
        method: 'POST',
        headers: {
          'Cartesia-Version': '2024-06-10',
          'X-API-Key': process.env.CARTESIA_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: `Cloned Voice ${Date.now()}`,
          description: "A voice cloned from an audio sample.",
          embedding: clonedVoice.embedding
        })
      });

      if (!createVoiceResponse.ok) {
        throw new Error(`Failed to create voice: ${await createVoiceResponse.text()}`);
      }

      const createdVoice = await createVoiceResponse.json();
      res.json({ voiceId: createdVoice.id });
    } catch (error) {
      console.error('Error cloning voice:', error);
      res.status(500).json({ error: 'Failed to clone voice', details: error.message });
    }
  });

  async function getTranscript(rawAudio) {
    const form = new FormData();
    form.append('file', rawAudio.file.buffer, {
      filename: 'audio.webm',
      contentType: rawAudio.file.mimetype,
    });
    form.append('model', 'whisper-large-v3');
    form.append('temperature', '0');
    form.append('response_format', 'json');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        ...form.getHeaders()
      },
      body: form
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(JSON.stringify(errorData));
    }

    const data = await response.json();
    return data.text.trim() || null;

  }

  async function translateText(text, targetLanguage) {
    const completion = await groqClient.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a TRANSLATOR. ONLY TRANSLATE THE INPUT TEXT INTO THE TARGET LANGUAGE. DO NOT INCLUDE ANYTHING BUT THE TRANSLATION`,
        },
        {
          role: "user",
          content: `Translate the following sentence into ${targetLanguage}; ONLY INCLUDE TRANSLATION, NOTHING ELSE: ${text}`,
        },
      ],
      model: "llama3-8b-8192",
      temperature: 0.5,
      max_tokens: 1024,
    });

    return completion.choices[0].message.content;
  }

  async function generateAudio(text, voiceId, language) {
    const response = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: 'POST',
      headers: {
        "Cartesia-Version": "2024-06-10",
        "X-API-Key": process.env.CARTESIA_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        "transcript": text,
        "model_id": language === "en" ? "sonic-english" : "sonic-multilingual", // MULTILINGUAL NOT GETTING SET
        "voice": {"mode":"id", "id": voiceId},
        "output_format":{"container":"raw", "encoding":"pcm_f32le", "sample_rate":44100},
        "language": language
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
    }

    return await response.arrayBuffer();
  }

  app.all('*', (req, res) => {
    return nextHandler(req, res);
  });

  const PORT = process.env.PORT || 3001;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
  });

});



// OLD


// wss.on('connection', (ws) => {
//   const clientId = Date.now().toString();
//   clients.set(clientId, { ws, language: null, voiceId: null });

//   ws.on('message', (message) => {
//     try {
//       const data = JSON.parse(message);
      
//       if (data.type === 'voiceId') {
//         ws.voiceId = data.voiceId;
//         console.log('Updated voiceId for client:', ws.voiceId);
//       } else if (data.type === 'language') {
//         ws.language = data.language;
//         clients.get(clientId).language = data.language;
//         console.log('Updated language for client:', ws.language);
//         // Broadcast the language to all other clients
//         clients.forEach((client, id) => {
//           if (id !== clientId && client.ws.readyState === WebSocket.OPEN) {
//             console.log("RECEIVED LANGUAGE", data.language)
//             client.ws.send(JSON.stringify({
//               type: 'language',
//               language: data.language
//             }));
//           }
//         });
//       }
//     } catch (error) {
//       console.error('Error parsing message:', error);
//     }
//   });

//   ws.on('close', () => {
//     clients.delete(ws);
//   });

// });



// NEW process-audio

// app.post('/process-audio', upload.single('audio'), async (req, res) => {
//   try {
//     const voiceId = req.body.voiceId || "a0e99841-438c-4a64-b679-ae501e7d6091";
//     const senderLanguage = req.body.senderLanguage;
//     const callId = req.body.callId;
//     const senderId = req.body.senderId;
    
//     if (calls.has(callId)) {
//       const clients = Array.from(calls.get(callId));
//       const originalAudio = req.file.buffer; // The original audio file
//       console.log("clients")
//       for (const client of clients) {

//         console.log("---------------------------------")
//         console.log("client.clientId", client.clientId)
//         console.log("senderId", senderId)
//         console.log("---------------------------------")

//         if (client.readyState === WebSocket.OPEN && client.clientId !== senderId) {
//           const receiverLanguage = clientLanguages.get(client.clientId);
//           print("receiverLanguage", receiverLanguage)
          
//           // If the sender and receiver have the same language 
//           if (receiverLanguage === senderLanguage) {
//             // Send original audio without translation
//             console.log(`Sending original audio to client ${client.clientId}`);
//             client.send(originalAudio, { binary: true });
//           } else {
//             // Transcribe the audio 
//             const transcription = await getTranscript(req);
//             console.log("TRANSCRIPTION", transcription);
//             // Translate and generate new audio
//             const translation = await translateText(transcription, receiverLanguage);
//             console.log("TRANSLATION", translation);
//             const audioBuffer = await generateAudio(translation, voiceId, receiverLanguage);
//             console.log("AUDIO GENERATED for", client.clientId);
//             // Send the audio 
//             client.send(audioBuffer, { binary: true });
//           }
//         }
//       }
//     }
    
//     res.status(200).json({ success: true });
//   } catch (error) {
//     console.error('Error processing audio:', error);
//     res.status(500).json({ error: 'Failed to process audio' });
//   }
// });

// app.post('/process-audio', upload.single('audio'), async (req, res) => {
//   try {
//     const voiceId = req.body.voiceId || "a0e99841-438c-4a64-b679-ae501e7d6091";
//     const receiverLanguage = req.body.receiverLanguage;
    
//     // Transcribe audio
//     const transcription = await getTranscript(req);
//     console.log("TRANSCRIPTION", transcription)
    
//     // Translate text
//     const translation = await translateText(transcription, receiverLanguage);
//     console.log("TRANSLATION", translation)
    
//     // Generate audio from translated text
//     const audioBuffer = await generateAudio(translation, voiceId, receiverLanguage);
//     console.log("AUDIO", audioBuffer)
    
//     // Send processed audio to the receiver
//     for (const [id, client] of clients.entries()) {
//       if (client.language === receiverLanguage && client.ws.readyState === WebSocket.OPEN) {
//         console.log('Sending audio to client:', id, 'Language:', client.language);
//         client.ws.send(audioBuffer, { binary: true });
//       }
//     }
    
//     res.status(200).json({ success: true });
//   } catch (error) {
//     console.error('Error processing audio:', error);
//     res.status(500).json({ error: 'Failed to process audio' });
//   }
// });