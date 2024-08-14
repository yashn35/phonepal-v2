"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { EnterIcon, LoadingIcon } from "@/lib/icons";
import { usePlayer } from "@/lib/usePlayer";
import { useMicVAD, utils } from "@ricky0123/vad-react";

export default function Home() {
    const [input, setInput] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const player = usePlayer();
    const [websocket, setWebsocket] = useState<WebSocket | null>(null);

    const vad = useMicVAD({
        startOnLoad: true,
        onSpeechEnd: (audio) => {
            player.stop();
            const wav = utils.encodeWAV(audio);
            const blob = new Blob([wav], { type: "audio/wav" });
            if (websocket && websocket.readyState === WebSocket.OPEN) {
                websocket.send(blob);
            }
            const isFirefox = navigator.userAgent.includes("Firefox");
            if (isFirefox) vad.pause();
        },
        workletURL: "/vad.worklet.bundle.min.js",
        modelURL: "/silero_vad.onnx",
        positiveSpeechThreshold: 0.6,
        minSpeechFrames: 4,
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
					"ort-wasm-simd-threaded.wasm":
						"/ort-wasm-simd-threaded.wasm",
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
        
        ws.onopen = () => {
            console.log('Connected to WebSocket server');
            setWebsocket(ws);
        };

        ws.onmessage = (event) => {
            if (event.data instanceof Blob) {
                player.play(event.data.stream(), () => {
                    const isFirefox = navigator.userAgent.includes("Firefox");
                    if (isFirefox) vad.start();
                });
            }
        };

        ws.onclose = () => {
            console.log('Disconnected from WebSocket server');
            setWebsocket(null);
        };

        return () => {
            ws.close();
        };
    }, []);

    useEffect(() => {
        function keyDown(e: KeyboardEvent) {
            if (e.key === "Enter") return inputRef.current?.focus();
            if (e.key === "Escape") return setInput("");
        }

        window.addEventListener("keydown", keyDown);
        return () => window.removeEventListener("keydown", keyDown);
    }, []);

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