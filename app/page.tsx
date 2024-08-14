// CURRENT VERSION

"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { EnterIcon, LoadingIcon } from "@/lib/icons";
import { usePlayer } from "@/lib/usePlayer";
import { useMicVAD, utils } from "@ricky0123/vad-react";

const languages = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "zh", name: "Chinese" },
  { code: "ja", name: "Japanese" },
];

export default function Home() {
    const [input, setInput] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const player = usePlayer();
    const [websocket, setWebsocket] = useState<WebSocket | null>(null);
    const [selectedLanguage, setSelectedLanguage] = useState("en");
    const [partnerLanguage, setPartnerLanguage] = useState("");
    const [userVoiceId, setUserVoiceId] = useState<string | null>(null);
    const [receivedAudio, setReceivedAudio] = useState<string | null>(null);

    const vad = useMicVAD({
        startOnLoad: true,
        onSpeechEnd: async (audio) => {
            player.stop();
            const wav = utils.encodeWAV(audio);
            const blob = new Blob([wav], { type: "audio/wav" });
            if (websocket && websocket.readyState === WebSocket.OPEN) {
                const formData = new FormData();
                formData.append('audio', blob);
                formData.append('voiceId', 'a0e99841-438c-4a64-b679-ae501e7d6091');
                formData.append('senderLanguage', selectedLanguage);
                formData.append('senderLanguage', selectedLanguage);
                formData.append('receiverLanguage', partnerLanguage || 'es');

                const response = await fetch('http://localhost:3001/process-audio', {
                    method: 'POST',
                    body: formData
                });

                if (response.ok) {
                    console.log('Audio processed successfully');
                } else {
                    console.error('Failed to process audio');
                }
            }
            const isFirefox = navigator.userAgent.includes("Firefox");
            if (isFirefox) vad.pause();
        },
        workletURL: "/vad.worklet.bundle.min.js",
        modelURL: "/silero_vad.onnx",
        positiveSpeechThreshold: 0.6,
        minSpeechFrames: 4,
        ortConfig(ort) {
            const isSafari = /^((?!chrome|android).)*safari/i.test(
                navigator.userAgent
            );

            ort.env.wasm = {
                wasmPaths: {
                    "ort-wasm-simd-threaded.wasm": "/ort-wasm-simd-threaded.wasm",
                    "ort-wasm-simd.wasm": "/ort-wasm-simd.wasm",
                    "ort-wasm.wasm": "/ort-wasm.wasm",
                    "ort-wasm-threaded.wasm": "/ort-wasm-threaded.wasm",
                },
                numThreads: isSafari ? 1 : 4,
            };
        },
    });

    useEffect(() => {
        const ws = new WebSocket('ws://localhost:3001');
        setWebsocket(ws);
        
        ws.onopen = () => {
            console.log('Connected to WebSocket server');
            
            ws.send(JSON.stringify({ type: 'language', language: selectedLanguage }));
            if (userVoiceId) {
                ws.send(JSON.stringify({ type: 'voiceId', voiceId: userVoiceId }));
            }
        };
        
        ws.onmessage = (event) => {
            if (event.data instanceof Blob) {
              // Handle binary audio data
              player.play(event.data.stream(), () => {
                const isFirefox = navigator.userAgent.includes("Firefox");
                if (isFirefox) vad.start();
              });
            } else if (typeof event.data === 'string') {
              // Handle string data (possibly JSON)
              try {
                const data = JSON.parse(event.data);
                if (data.type === 'language') {
                  setPartnerLanguage(data.language);
                }
              } catch (error) {
                console.error('Error parsing WebSocket message:', error);
              }
            } else {
              console.warn('Received unknown data type from WebSocket:', typeof event.data);
            }
          };
          

        ws.onclose = () => {
            console.log('Disconnected from WebSocket server');
            // setWebsocket(null);
        };

        return () => {
            ws.close();
        };
    }, [selectedLanguage, userVoiceId]);

    const handleLanguageChange = (e) => {
        const newLanguage = e.target.value
        setSelectedLanguage(newLanguage);
        
        if (websocket && websocket.readyState === WebSocket.OPEN) {
            console.log(newLanguage)
            websocket.send(JSON.stringify({ type: 'language', language: newLanguage }));
          }
    };

    const handleVoiceClone = async (e) => {
        const file = e.target.files[0];
        if (file) {
            const formData = new FormData();
            formData.append('voiceSample', file);
            const response = await fetch('http://localhost:3001/clone-voice', {
                method: 'POST',
                body: formData
            });
            if (response.ok) {
                const { voiceId } = await response.json();
                setUserVoiceId(voiceId);
                if (websocket && websocket.readyState === WebSocket.OPEN) {
                    websocket.send(JSON.stringify({ type: 'voiceId', voiceId }));
                }
            } else {
                console.error('Failed to clone voice');
            }
        }
    };

    return (
        <>
            <div className="pb-4 min-h-28" />

            <div className="text-neutral-400 dark:text-neutral-600 pt-4 text-center max-w-xl text-balance min-h-28 space-y-4">
                {websocket ? (
                    <p>Connected to WebSocket server. Start talking to chat.</p>
                ) : (
                    <p>Connecting to WebSocket server...</p>
                )}

                {vad.loading ? (
                    <p>Loading speech detection...</p>
                ) : vad.errored ? (
                    <p>Failed to load speech detection.</p>
                ) : (
                    <p>{vad.userSpeaking ? "Speaking..." : "Not speaking"}</p>
                )}

                <div>
                    <label htmlFor="language-select">Select your language: </label>
                    <select id="language-select" value={selectedLanguage} onChange={handleLanguageChange}>
                        {languages.map(lang => (
                            <option key={lang.code} value={lang.code}>{lang.name}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label htmlFor="voice-clone">Clone your voice: </label>
                    <input type="file" id="voice-clone" accept="audio/*" onChange={handleVoiceClone} />
                    {userVoiceId && <p>Voice ID: {userVoiceId}</p>}
                </div>

                <p>Partner's language: {languages.find(lang => lang.code === partnerLanguage)?.name || 'Not selected'}</p>
            </div>

            <div
                className={clsx(
                    "absolute size-36 blur-3xl rounded-full bg-gradient-to-b from-red-200 to-red-400 dark:from-red-600 dark:to-red-800 -z-50 transition ease-in-out",
                    {
                        "opacity-0": vad.loading || vad.errored,
                        "opacity-30":
                            !vad.loading && !vad.errored && !vad.userSpeaking,
                        "opacity-100 scale-110": vad.userSpeaking,
                    }
                )}
            />
        </>
    );
}
