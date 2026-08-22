/**
 * "Luminous Horizon" design tokens, ported verbatim from the user-supplied
 * DESIGN.md / code.html reference set (stitch_chronos_premium_attendance).
 */
export const LH = {
  onSurface: "#1b1b1f",
  surfaceBright: "#fbf8fd",
  onSecondaryContainer: "#ede4ff",
  surfaceContainerHighest: "#e4e1e6",
  secondary: "#5902e8",
  secondaryFixedDim: "#cdbdff",
  errorContainer: "#ffdad6",
  inverseSurface: "#303033",
  tertiaryContainer: "#00184f",
  background: "#F8FAFF",
  onTertiaryFixed: "#00174c",
  onPrimaryFixedVariant: "#3b4471",
  onPrimaryFixed: "#0e1743",
  onTertiary: "#ffffff",
  onSecondaryFixed: "#20005f",
  onErrorContainer: "#93000a",
  inverseOnSurface: "#f3f0f4",
  surfaceDim: "#dcd9dd",
  inversePrimary: "#bbc4f8",
  surfaceContainerLow: "#f6f2f7",
  error: "#ba1a1a",
  surface: "#fbf8fd",
  surfaceVariant: "#e4e1e6",
  surfaceTint: "#535c8a",
  tertiaryFixedDim: "#b4c5ff",
  outline: "#767680",
  onTertiaryContainer: "#4d7dff",
  secondaryContainer: "#723aff",
  onError: "#ffffff",
  primaryContainer: "#101944",
  primary: "#000114",
  primaryFixed: "#dee1ff",
  onSecondaryFixedVariant: "#4f00d0",
  secondaryFixed: "#e7deff",
  tertiaryFixed: "#dbe1ff",
  onSurfaceVariant: "#46464f",
  onTertiaryFixedVariant: "#003daa",
  surfaceContainerHigh: "#eae7ec",
  onSecondary: "#ffffff",
  onPrimary: "#ffffff",
  onPrimaryContainer: "#7a82b3",
  surfaceContainer: "#f0edf1",
  surfaceContainerLowest: "#ffffff",
  primaryFixedDim: "#bbc4f8",
  outlineVariant: "#c6c5d0",
  tertiary: "#00020f",
  onBackground: "#1b1b1f",
  // Signature gradient (Home screen) — violet -> electric blue -> mint
  violet: "#7639FF",
  cyan: "#00D2FF",
  mint: "#19CEA0",
  navy: "#101A46",
} as const;

/**
 * Per-status color + icon language, used consistently everywhere a day's status is shown
 * (day-status picker, calendar cells, day rows, leave rings): worked = green, off = red,
 * vacation = blue, sick = amber, holiday = violet.
 */
export const STATUS_META = {
  worked: { label: "עבד", icon: "work", grad: ["#16A34A", "#4ADE80"] as [string, string], glow: "rgba(22,163,74,0.5)", tint: "rgba(22,163,74,0.08)" },
  off: { label: "לא עובד", icon: "block", grad: ["#DC2626", "#F87171"] as [string, string], glow: "rgba(220,38,38,0.5)", tint: "rgba(220,38,38,0.08)" },
  vacation: { label: "חופשה", icon: "beach_access", grad: ["#2563EB", "#60A5FA"] as [string, string], glow: "rgba(37,99,235,0.5)", tint: "rgba(37,99,235,0.08)" },
  sick: { label: "מחלה", icon: "thermostat", grad: ["#D97706", "#FBBF24"] as [string, string], glow: "rgba(217,119,6,0.5)", tint: "rgba(217,119,6,0.08)" },
  holiday: { label: "חג", icon: "celebration", grad: ["#7639FF", "#B39CFF"] as [string, string], glow: "rgba(118,57,255,0.5)", tint: "rgba(118,57,255,0.08)" },
} as const;

export type StatusKey = keyof typeof STATUS_META;

export const typo = {
  heroNum: { fontSize: 48, lineHeight: "52px", letterSpacing: "-0.04em", fontWeight: 800 },
  headlineLg: { fontSize: 32, lineHeight: "40px", letterSpacing: "-0.02em", fontWeight: 700 },
  headlineMd: { fontSize: 24, lineHeight: "32px", letterSpacing: "-0.01em", fontWeight: 700 },
  bodyLg: { fontSize: 18, lineHeight: "28px", fontWeight: 400 },
  bodyMd: { fontSize: 16, lineHeight: "24px", fontWeight: 400 },
  labelCaps: { fontSize: 12, lineHeight: "16px", letterSpacing: "0.08em", fontWeight: 700 },
} as const;
