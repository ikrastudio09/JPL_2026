"use client";

import { useRef, useState } from "react";

/**
 * ImageUpload Component
 * Drag & drop image upload with preview, file validation, replacement and removal.
 */
export default function ImageUpload({
  label,
  name,
  onImageSelect,
  previewUrl,
  error,
  accept = "image/jpeg,image/png,image/webp,image/jpg",
  hint,
  icon = "📸",
  required = false,
  // Optional overrides (defaults preserve the original player-photo behaviour)
  allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/jpg"],
  allowedExtensions = [".jpg", ".jpeg", ".png", ".webp"],
  typeErrorMessage = "Only JPG, PNG, and WebP images are allowed.",
  maxSizeBytes = 3 * 1024 * 1024,
  requireTypeAndExtension = false,
  uploadState = null, // { status: "uploading" | "done" | "error", progress: 0-100 }
  showActions = false, // always-visible Replace / Remove buttons (touch friendly)
}) {
  const inputRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFile = (file) => {
    if (!file) return;

    // Validate file type
    const fileExt = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    const typeOk = allowedTypes.includes(file.type);
    const extOk = allowedExtensions.includes(fileExt);

    if (requireTypeAndExtension ? !(typeOk && extOk) : !typeOk && !extOk) {
      onImageSelect(null, typeErrorMessage);
      return;
    }

    // Validate file size
    if (file.size > maxSizeBytes) {
      const mb = Math.round((maxSizeBytes / (1024 * 1024)) * 10) / 10;
      onImageSelect(null, `Image size must be under ${mb} MB.`);
      return;
    }

    if (file.size === 0) {
      onImageSelect(null, "Image file is empty.");
      return;
    }

    onImageSelect(file, null);
  };

  const handleInputChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
    // Reset file input value so selecting the same file again triggers change event
    e.target.value = "";
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFile(file);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  const handleRemove = (e) => {
    e.stopPropagation();
    onImageSelect(null, null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="flex flex-col gap-1.5">
      {/* Label */}
      <label
        className="flex items-center gap-2 text-sm font-medium"
        style={{
          color: "rgba(232,245,233,0.7)",
          fontFamily: "var(--font-accent)",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          fontSize: "11px",
        }}
      >
        <span className="text-base">{icon}</span>
        {label}
        {required && <span style={{ color: "#f59e0b" }}>*</span>}
      </label>

      {/* Upload Zone */}
      <div
        onClick={() => !previewUrl && inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`relative upload-zone rounded-xl overflow-hidden cursor-pointer transition-all duration-300 ${
          isDragOver ? "drag-over" : ""
        }`}
        style={{
          border: `2px dashed ${
            error
              ? "rgba(239,68,68,0.5)"
              : isDragOver
                ? "rgba(34,197,94,0.7)"
                : "rgba(255,255,255,0.12)"
          }`,
          background: isDragOver
            ? "rgba(34,197,94,0.05)"
            : "rgba(255,255,255,0.02)",
          minHeight: previewUrl ? "auto" : "140px",
        }}
      >
        {previewUrl ? (
          /* Image Preview */
          <div className="relative group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt={label || "Preview"}
              className="w-full object-contain"
              style={{ maxHeight: "240px", background: "rgba(0,0,0,0.3)" }}
            />
            {/* Overlay buttons for changing or removing image */}
            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3 p-4">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  inputRef.current?.click();
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold tracking-wider transition-all duration-150"
                style={{
                  background: "linear-gradient(135deg, #16a34a, #22c55e)",
                  color: "#fff",
                  boxShadow: "0 4px 12px rgba(34,197,94,0.4)",
                }}
              >
                🔄 Replace Image
              </button>
              <button
                type="button"
                onClick={handleRemove}
                className="px-4 py-2 rounded-xl text-xs font-semibold tracking-wider transition-all duration-150"
                style={{
                  background: "linear-gradient(135deg, #dc2626, #ef4444)",
                  color: "#fff",
                  boxShadow: "0 4px 12px rgba(239,68,68,0.4)",
                }}
              >
                🗑️ Remove
              </button>
            </div>
            {/* Selected badge */}
            <div
              className="absolute top-2 right-2 px-2.5 py-1 rounded-lg text-xs flex items-center gap-1 font-semibold"
              style={{
                background:
                  uploadState?.status === "uploading"
                    ? "rgba(245,158,11,0.9)"
                    : uploadState?.status === "error"
                      ? "rgba(239,68,68,0.9)"
                      : "rgba(34,197,94,0.9)",
                color: "#fff",
                fontFamily: "var(--font-accent)",
              }}
            >
              {uploadState?.status === "uploading" ? (
                <>Uploading {uploadState.progress || 0}%</>
              ) : uploadState?.status === "error" ? (
                <>⚠ Upload failed</>
              ) : uploadState?.status === "done" ? (
                <>
                  <span>✓</span> Uploaded
                </>
              ) : (
                <>
                  <span>✓</span> Ready
                </>
              )}
            </div>

            {/* Upload progress bar */}
            {uploadState?.status === "uploading" && (
              <div
                className="absolute bottom-0 left-0 right-0 h-1.5"
                style={{ background: "rgba(0,0,0,0.4)" }}
              >
                <div
                  className="h-full transition-all duration-200"
                  style={{
                    width: `${uploadState.progress || 0}%`,
                    background: "linear-gradient(90deg, #16a34a, #22c55e)",
                  }}
                />
              </div>
            )}
          </div>
        ) : (
          /* Upload Placeholder */
          <div className="flex flex-col items-center justify-center p-8 gap-3">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl"
              style={{
                background: "rgba(34,197,94,0.1)",
                border: "1px solid rgba(34,197,94,0.2)",
              }}
            >
              {icon}
            </div>
            <div className="text-center">
              <p
                className="text-sm font-medium"
                style={{ color: "rgba(232,245,233,0.8)" }}
              >
                Drop image here or{" "}
                <span style={{ color: "var(--color-green)" }}>browse</span>
              </p>
              <p
                className="text-xs mt-1"
                style={{ color: "var(--color-text-dim)" }}
              >
                {hint || "JPG, PNG, WebP — max 3MB"}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Always-visible actions (mobile friendly) */}
      {showActions && previewUrl && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploadState?.status === "uploading"}
            className="flex-1 px-3 py-2 rounded-xl text-xs font-semibold tracking-wider"
            style={{
              background: "rgba(34,197,94,0.12)",
              border: "1px solid rgba(34,197,94,0.35)",
              color: "#4ade80",
              opacity: uploadState?.status === "uploading" ? 0.6 : 1,
            }}
          >
            🔄 Replace
          </button>
          <button
            type="button"
            onClick={handleRemove}
            className="flex-1 px-3 py-2 rounded-xl text-xs font-semibold tracking-wider"
            style={{
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.35)",
              color: "#f87171",
            }}
          >
            🗑️ Remove
          </button>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={inputRef}
        id={name}
        name={name}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        className="hidden"
      />

      {/* Error */}
      {error && (
        <p
          className="text-xs flex items-center gap-1 animate-fade-in"
          style={{ color: "#f87171" }}
        >
          <span>⚠</span> {error}
        </p>
      )}
    </div>
  );
}
