import { encode } from 'uqr';

/** The QR of a TOTP URI, drawn as SVG cells from the token colours (no innerHTML). */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { data, size } = encode(value, { border: 2 });
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      className="w-[192px]"
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} className="fill-surface" />
      {data.flatMap((row, y) =>
        row.map((on, x) =>
          on ? (
            <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} className="fill-text" />
          ) : null,
        ),
      )}
    </svg>
  );
}
