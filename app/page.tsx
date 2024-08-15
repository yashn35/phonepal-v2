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
//   { code: "zh", name: "Chinese" },
//   { code: "ja", name: "Japanese" },
];

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';

interface CustomWebSocket extends WebSocket {
    clientId?: string;
}  

export default function Home() {
    const [step, setStep] = useState<'setup' | 'call'>('setup');
    const [selectedLanguage, setSelectedLanguage] = useState("en");
    const [userVoiceId, setUserVoiceId] = useState<string | null>(null);
    const [websocket, setWebsocket] = useState<CustomWebSocket | null>(null);
    const [partnerLanguage, setPartnerLanguage] = useState("");
    const [input, setInput] = useState("");
    const audioQueue = useRef<Blob[]>([]);
    const player = usePlayer();
    const isPlaying = useRef(false);

    // Caller ID
    const [callId, setCallId] = useState("");
    const [isInCall, setIsInCall] = useState(false);

    const vad = useMicVAD({
        startOnLoad: true,
        onSpeechEnd: async (audio) => {
            player.stop();
            const wav = utils.encodeWAV(audio);
            const blob = new Blob([wav], { type: "audio/wav" });
            if (websocket && websocket.readyState === WebSocket.OPEN && isInCall) {
                const formData = new FormData();
                formData.append('audio', blob);
                formData.append('voiceId', userVoiceId || 'a0e99841-438c-4a64-b679-ae501e7d6091');
                formData.append('senderLanguage', selectedLanguage);
                formData.append('receiverLanguage', partnerLanguage || 'es');
                formData.append('callId', callId);
                // formData.append('senderId', websocket.clientId); 

                const response = await fetch(`${API_URL}/process-audio`, {
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
            const ws = new WebSocket(WS_URL) as CustomWebSocket;
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
                    audioQueue.current.push(event.data);
                    playNextInQueue();
                } else if (typeof event.data === 'string') {
                    try {
                        const data = JSON.parse(event.data);
                        if (data.type === 'language') {
                            setPartnerLanguage(data.language);
                        } else if (data.type === 'callCreated' || data.type === 'callJoined') {
                            setCallId(data.callId);
                            setIsInCall(true);
                        } else if (data.type === 'error') {
                            console.error('WebSocket error:', data.message);
                        }
                    } catch (error) {
                        console.error('Error parsing WebSocket message:', error);
                    }
                }
            };

        ws.onclose = () => {
            console.log('Disconnected from WebSocket server');
            setIsInCall(false);
            // setWebsocket(null);
        };

        return () => {
            ws.close();
        };
    }, []);

    useEffect(() => {
        if (websocket && websocket.readyState === WebSocket.OPEN) {
            websocket.send(JSON.stringify({ type: 'language', language: selectedLanguage }));
        }
    }, [selectedLanguage, websocket]);

    useEffect(() => {
        if (websocket && websocket.readyState === WebSocket.OPEN && userVoiceId) {
            websocket.send(JSON.stringify({ type: 'voiceId', voiceId: userVoiceId }));
        }
    }, [userVoiceId, websocket]);

    const playNextInQueue = () => {
        if (audioQueue.current.length > 0 && !isPlaying.current) {
            isPlaying.current = true;
            const nextAudio = audioQueue.current.shift();
            player.play(nextAudio!.stream(), () => {
                const isFirefox = navigator.userAgent.includes("Firefox");
                if (isFirefox) vad.start();
                isPlaying.current = false;
                playNextInQueue(); // Play the next audio in queue when current one finishes
            });
        }
    };    

    const createCall = () => {
        if (websocket && websocket.readyState === WebSocket.OPEN) {
            websocket.send(JSON.stringify({ type: 'createCall' }));
        }
    };

    const joinCall = (inputCallId: string) => {
        if (websocket && websocket.readyState === WebSocket.OPEN) {
            websocket.send(JSON.stringify({ type: 'joinCall', callId: inputCallId }));
        }
    };

    // const handleLanguageChange = (e) => {
    //     const newLanguage = e.target.value
    //     setSelectedLanguage(newLanguage);
        
    //     if (websocket && websocket.readyState === WebSocket.OPEN) {
    //         console.log(newLanguage)
    //         websocket.send(JSON.stringify({ type: 'language', language: newLanguage }));
    //       }
    // };

    const handleLanguageChange = (e) => {
        const newLanguage = e.target.value;
        setSelectedLanguage(newLanguage);
    };

    const handleVoiceClone = async (e) => {
        const file = e.target.files[0];
        if (file) {
            const formData = new FormData();
            formData.append('voiceSample', file);
            const response = await fetch(`${API_URL}/clone-voice`, {
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
                    isInCall ? (
                        <p>In call: {callId}</p>
                    ) : (
                        <>
                            <button onClick={createCall}>Create Call</button>
                            <div>
                                <input
                                    type="text"
                                    placeholder="Enter Call ID"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                />
                                <button onClick={() => joinCall(input)}>Join Call</button>
                            </div>
                        </>
                    )
                ) : (
                    <p>Connecting to WebSocket server...</p>
                )} 
                
                </div>

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

                <p>Partner&apos;s language: {languages.find(lang => lang.code === partnerLanguage)?.name || 'Not selected'}</p>
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
