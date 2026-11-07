export function PoseSchematic({
  ids,
  title,
  index,
}: {
  ids: string[];
  title: string;
  index: number;
}) {
  return (
    <figure className="pose-schematic">
      <svg
        viewBox="0 0 600 180"
        role="img"
        aria-label={`Original arrangement guide for ${title}, ${ids.length} people`}
      >
        <rect width="600" height="180" rx="20" fill="#f5f5f7" />
        <path d="M35 140H565" stroke="#c5c7cc" strokeDasharray="5 5" />
        {ids.map((id, i) => {
          const x = ids.length === 1 ? 300 : 60 + (i * 480) / (ids.length - 1);
          const y = 65 + ((i + index) % 2) * 25;
          return (
            <g key={id} data-pose-subject={id}>
              <circle
                cx={x}
                cy={y}
                r={Math.min(21, 180 / ids.length)}
                fill="#0066cc"
              />
              <text
                x={x}
                y={y + 43}
                textAnchor="middle"
                fontSize="13"
                fill="#1d1d1f"
              >
                {i + 1}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption>
        Original face-spacing schematic. Illustrative positions; follow the
        written directions and confirm safe support.
      </figcaption>
    </figure>
  );
}
