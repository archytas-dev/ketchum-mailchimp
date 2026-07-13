import Image from "next/image";

const HREF = "https://www.archytas.io/";

export default function Footer({
  vertical = false,
  logoSize = 14,
  className = "",
}: {
  vertical?: boolean;
  logoSize?: number;
  className?: string;
}) {
  if (vertical) {
    return (
      <footer className="py-6">
        <a
          href={HREF}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex flex-col items-center gap-2 text-xs text-slate-400 transition-opacity hover:opacity-80 ${className}`}
        >
          <span>
            By <span className="font-medium text-[#243f55]">Archytas</span>
          </span>
          <Image
            src="/archytas.webp"
            alt="Archytas"
            width={logoSize}
            height={logoSize}
            className="opacity-90"
          />
        </a>
      </footer>
    );
  }

  return (
    <div className="py-4">
      <a
        href={HREF}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex items-center justify-center gap-1.5 text-xs text-slate-400 transition-opacity hover:opacity-80 ${className}`}
      >
        <span>By</span>
        <Image
          src="/archytas.webp"
          alt="Archytas"
          width={logoSize}
          height={logoSize}
          className="opacity-80"
        />
        <span className="font-medium">Archytas</span>
      </a>
    </div>
  );
}
