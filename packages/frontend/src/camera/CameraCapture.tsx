import { useEffect, useRef, useState } from "react";
import { Alert, Button, Group, Image, Loader, Stack, Text } from "@mantine/core";

interface CameraCaptureProps {
  onCapture: (file: File) => void;
  onClose: () => void;
}

type Phase = "starting" | "live" | "review" | "denied" | "unsupported";

export default function CameraCapture({ onCapture, onClose }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const capturedUrlRef = useRef<string | null>(null);

  const [phase, setPhase] = useState<Phase>("starting");
  const [captured, setCaptured] = useState<{ file: File; url: string } | null>(null);
  const [error, setError] = useState("");

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const revokeCaptured = () => {
    if (capturedUrlRef.current) {
      URL.revokeObjectURL(capturedUrlRef.current);
      capturedUrlRef.current = null;
    }
  };

  // Start the camera on mount; stop tracks + revoke URLs on unmount.
  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPhase("unsupported");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // Some mobile browsers don't honor the autoPlay attribute for a
          // programmatically-assigned srcObject; nudge playback explicitly.
          try {
            await videoRef.current.play();
          } catch {
            // Autoplay may already be running, or be blocked — ignore.
          }
        }
        setPhase("live");
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        setPhase(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unsupported");
      }
    }
    void start();
    return () => {
      cancelled = true;
      stopStream();
      revokeCaptured();
    };
  }, []);

  const handleCapture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    if (!video.videoWidth || !video.videoHeight) {
      setError("Camera isn't ready yet — give it a moment and try again.");
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("Could not capture the photo. Try again.");
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError("Could not capture the photo. Try again.");
          return;
        }
        const file = new File([blob], `receipt-${Date.now()}.jpg`, { type: "image/jpeg" });
        revokeCaptured();
        const url = URL.createObjectURL(blob);
        capturedUrlRef.current = url;
        setCaptured({ file, url });
        setError("");
        setPhase("review");
      },
      "image/jpeg",
      0.9,
    );
  };

  const handleRetake = () => {
    revokeCaptured();
    setCaptured(null);
    setError("");
    setPhase("live");
  };

  const handleUse = () => {
    if (!captured) return;
    stopStream();
    onCapture(captured.file);
  };

  if (phase === "denied" || phase === "unsupported") {
    return (
      <Stack>
        <Alert color="red">
          {phase === "denied"
            ? "Camera permission was denied — you can upload an image instead."
            : "Camera isn't available on this device or browser — use Upload image instead."}
        </Alert>
        <Group>
          <Button variant="default" onClick={onClose}>
            Back
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <Stack>
      {phase === "starting" && (
        <Group>
          <Loader size="sm" />
          <Text c="dimmed">Starting camera…</Text>
        </Group>
      )}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ width: "100%", borderRadius: 8, display: phase === "live" ? "block" : "none" }}
      />
      {phase === "review" && captured && (
        <Image src={captured.url} alt="Captured receipt" radius="sm" />
      )}
      <canvas ref={canvasRef} style={{ display: "none" }} />
      {error && <Alert color="red">{error}</Alert>}
      <Group>
        {phase === "live" && (
          <>
            <Button onClick={handleCapture}>Capture</Button>
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
          </>
        )}
        {phase === "review" && (
          <>
            <Button onClick={handleUse}>Use this photo</Button>
            <Button variant="default" onClick={handleRetake}>
              Retake
            </Button>
          </>
        )}
      </Group>
    </Stack>
  );
}
