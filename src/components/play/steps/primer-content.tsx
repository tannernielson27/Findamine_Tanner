/* eslint-disable @next/next/no-img-element -- creator-supplied URLs of unknown size/host */

/** Renders a stop primer's content: text, bullet items, an image and/or a video. */
export function PrimerContent({ content }: { content: Record<string, unknown> }) {
  const text = (content.text as string) || "";
  const imageUrl = (content.image_url as string) || (content.imageUrl as string) || "";
  const videoUrl = (content.video_url as string) || (content.videoUrl as string) || "";
  const items = content.items as string[] | undefined;

  return (
    <div className="space-y-3">
      {text && <p className="text-base text-themed-text">{text}</p>}

      {items && items.length > 0 && (
        <ul className="list-disc list-inside text-base text-themed-text space-y-1">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}

      {imageUrl && (
        <img
          src={imageUrl}
          alt="Primer illustration"
          className="rounded-lg max-h-48 mx-auto"
        />
      )}

      {videoUrl && (
        <div className="aspect-video rounded-lg overflow-hidden">
          <iframe
            src={videoUrl}
            title="Primer video"
            className="w-full h-full"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin"
          />
        </div>
      )}

      {/* Fallback: if content has no recognized fields, show raw text */}
      {!text && !imageUrl && !videoUrl && !items && (
        <p className="text-base text-themed-text">
          {typeof content === "string" ? content : "Review this concept before continuing."}
        </p>
      )}
    </div>
  );
}
