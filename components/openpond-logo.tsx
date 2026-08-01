import Image from "next/image";

export function OpenPondLogo({ size = "large" }: { size?: "small" | "large" }) {
  const pixels = size === "small" ? 28 : 44;
  return (
    <Image
      alt=""
      aria-hidden="true"
      className={`brand-logo ${size}`}
      height={pixels}
      src="/openpond-icon.png"
      width={pixels}
    />
  );
}
