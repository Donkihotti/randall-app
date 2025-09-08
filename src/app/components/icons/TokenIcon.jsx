import Image from "next/image";

export default function TokenIcon({ size = 24, className = "" }) {
  return (
    <Image
      src="/token.svg"
      alt="Token Icon"
      width={size}
      height={size}
      className={className}
    />
  );
}