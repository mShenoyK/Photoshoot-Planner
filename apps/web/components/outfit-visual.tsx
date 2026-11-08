export function OutfitVisual({
  colors,
  label,
}: {
  colors: string;
  label: string;
}) {
  const named: Record<string, string> = {
    cream: "#e8deca",
    navy: "#26374a",
    terracotta: "#aa6f51",
    slate: "#63717d",
    "muted blue": "#809cb3",
    blue: "#386da8",
    red: "#b94444",
    green: "#648168",
    black: "#252528",
    white: "#f5f4ee",
    pink: "#d39aae",
    purple: "#8972a2",
    yellow: "#d5bb65",
    brown: "#91745c",
    gray: "#93979d",
    grey: "#93979d",
  };
  const palette = colors.match(/#[0-9a-fA-F]{6}\b/g) ?? [
    named[colors.toLowerCase().trim()] ?? "#c1c5cb",
  ];
  return (
    <svg
      viewBox="0 0 180 180"
      role="img"
      aria-label={`Original outfit palette moodboard for ${label}`}
      className="outfit-visual"
    >
      <rect width="180" height="180" rx="16" fill="#f5f5f7" />
      <path
        d="M52 28L36 38 20 65 40 77 47 65 47 110 109 110 109 65 116 77 136 65 120 38 104 28Q78 48 52 28Z"
        fill={palette[0]}
        stroke="#475569"
        strokeWidth="2"
      />
      <path
        d="M55 117H103L109 162H88L79 135 70 162H49Z"
        fill={palette[1 % palette.length]}
        stroke="#475569"
        strokeWidth="2"
      />
      {palette.slice(0, 5).map((color, i) => (
        <circle
          key={i}
          cx="153"
          cy={35 + i * 27}
          r="10"
          fill={color}
          stroke="#475569"
        />
      ))}
    </svg>
  );
}
