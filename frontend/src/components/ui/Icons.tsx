import type { CSSProperties, SVGProps } from "react";

/**
 * Conjunto de ícones em SVG inline.
 *
 * Por que inline e sem biblioteca externa: zero dependências, zero requisições,
 * tree-shaking natural e controle total do traço — tudo alinhado à meta de
 * performance do projeto. Todos herdam `currentColor` e são acessíveis.
 */

export type IconName =
  | "search" | "cart" | "heart" | "user" | "users" | "package" | "boxes" | "message" | "messages"
  | "menu" | "close" | "chevronLeft" | "chevronRight" | "chevronDown" | "chevronUp"
  | "plus" | "minus" | "trash" | "edit" | "check" | "checkCircle" | "xCircle" | "alertTriangle" | "alertCircle" | "info"
  | "star" | "starFilled" | "filter" | "grid" | "list" | "truck" | "shield" | "shieldCheck" | "card" | "barcode"
  | "home" | "bell" | "logout" | "settings" | "image" | "upload" | "eye" | "eyeOff"
  | "arrowRight" | "arrowLeft" | "arrowUp" | "arrowDown" | "externalLink" | "copy" | "print" | "download" | "refresh"
  | "clock" | "mapPin" | "phone" | "mail" | "instagram" | "facebook" | "whatsapp" | "youtube" | "tiktok"
  | "sparkles" | "tag" | "layers" | "clipboard" | "chart" | "flask" | "fileText" | "sliders" | "palette"
  | "lock" | "unlock" | "calendar" | "moreVertical" | "store" | "creditCard" | "percent" | "gift" | "trophy"
  | "loader" | "camera" | "link" | "wifiOff" | "receipt" | "wallet" | "trendingUp" | "userCheck" | "circleDot" | "box"
  | "instagram2" | "send" | "paperclip" | "monitor" | "smartphone" | "tablet" | "rr" | "shieldOff";

const PATHS: Record<IconName, string> = {
  box: "M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8ZM3.3 7l8.7 5 8.7-5M12 22V12",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35",
  cart: "M6 6h15l-1.5 9h-12L6 6Zm0 0-.8-3H2m5 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm11 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  heart: "M20.8 5.6a5.4 5.4 0 0 0-7.7 0L12 6.7l-1.1-1.1a5.4 5.4 0 1 0-7.7 7.7l1.1 1L12 22l7.7-7.7 1.1-1a5.4 5.4 0 0 0 0-7.7Z",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm14 14v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  package: "M16.5 9.4 7.5 4.21M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16ZM3.3 7l8.7 5 8.7-5M12 22V12",
  boxes: "M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42ZM7 16.5l-4.74-2.85M7 16.5v4.17M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3ZM17 16.5l-5-3m5 3-4.74-2.85M17 16.5v4.17M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8ZM12 8 7.26 5.15M12 8l4.74-2.85M12 13.5V8",
  message: "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z",
  messages: "M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5Zm4 2h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1",
  menu: "M3 6h18M3 12h18M3 18h18",
  close: "M18 6 6 18M6 6l12 12",
  chevronLeft: "m15 18-6-6 6-6",
  chevronRight: "m9 18 6-6-6-6",
  chevronDown: "m6 9 6 6 6-6",
  chevronUp: "m18 15-6-6-6 6",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  trash: "M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14ZM10 11v6M14 11v6",
  edit: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7m-2.5-9.5a2.12 2.12 0 0 1 3 3L12 16l-4 1 1-4 9.5-9.5Z",
  check: "m20 6-11 11-5-5",
  checkCircle: "M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3",
  xCircle: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm-3-7 6-6m0 6-6-6",
  alertTriangle: "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0ZM12 9v4m0 4h.01",
  alertCircle: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-6v-4m0-4h.01",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-6v-4m0-4h.01",
  star: "m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2Z",
  starFilled: "m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2Z",
  filter: "M22 3H2l8 9.46V19l4 2v-8.54L22 3Z",
  grid: "M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  truck: "M1 3h15v13H1zM16 8h4l3 3v5h-7V8ZM5.5 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm13 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z",
  shieldCheck: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Zm-3-11 2 2 4-4",
  shieldOff: "M19.7 14a10.4 10.4 0 0 0 .3-2V5l-8-3-3.2 1.2M4.6 4.6 4 5v7c0 2.5 1.4 4.7 3.3 6.3M2 2l20 20",
  card: "M2 5h20v14H2V5Zm0 5h20",
  creditCard: "M2 5h20v14H2V5Zm0 5h20M6 15h4",
  barcode: "M3 5v14M7 5v14M11 5v9M15 5v14M19 5v9M21 5v14",
  home: "m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Zm6 13v-8h6v8",
  bell: "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z",
  image: "M3 3h18v18H3V3Zm0 13 5-5 4 4 3-3 6 6M8.5 8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m14-7-5-5-5 5m5-5v12",
  eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Zm11 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  eyeOff: "M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a17.8 17.8 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M6.61 6.61A17.8 17.8 0 0 0 1 12s4 8 11 8a9 9 0 0 0 5.39-1.61M1 1l22 22",
  arrowRight: "M5 12h14m-7-7 7 7-7 7",
  arrowLeft: "M19 12H5m7 7-7-7 7-7",
  arrowUp: "M12 19V5m-7 7 7-7 7 7",
  arrowDown: "M12 5v14m7-7-7 7-7-7",
  externalLink: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6m4-3h6v6m-11 5L21 3",
  copy: "M20 9H11a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2Zm-3-4H4a2 2 0 0 0-2 2v9",
  print: "M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6v-8Z",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  refresh: "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-16v6l4 2",
  mapPin: "M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0Zm-9 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  phone: "M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z",
  mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm18 2-10 7L2 6",
  instagram: "M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm5 5.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM17.5 6.5h.01",
  instagram2: "M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm5 5.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM17.5 6.5h.01",
  facebook: "M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3V2Z",
  whatsapp: "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z",
  youtube: "M22.5 7.4a2.8 2.8 0 0 0-2-2C18.9 5 12 5 12 5s-6.9 0-8.5.4a2.8 2.8 0 0 0-2 2A29 29 0 0 0 1 12a29 29 0 0 0 .5 4.6 2.8 2.8 0 0 0 2 2C5.1 19 12 19 12 19s6.9 0 8.5-.4a2.8 2.8 0 0 0 2-2A29 29 0 0 0 23 12a29 29 0 0 0-.5-4.6ZM9.8 15.1V8.9L15 12l-5.2 3.1Z",
  tiktok: "M16 8.2a6.5 6.5 0 0 0 4 1.4V6.4a3.9 3.9 0 0 1-3.9-3.9h-3.2v12.3a2.5 2.5 0 1 1-2.5-2.5c.2 0 .5 0 .7.1V9.1a5.8 5.8 0 1 0 4.9 5.7V8.2Z",
  sparkles: "m12 3 1.9 4.8L19 9.7l-4.2 3 .6 5.2L12 15.4 8.6 17.9l.6-5.2L5 9.7l5.1-1.9L12 3ZM19 3v3M20.5 4.5h-3M5 17v3M6.5 18.5h-3",
  tag: "M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8ZM7.5 7.5h.01",
  layers: "m12 2 10 6-10 6L2 8l10-6Zm10 12-10 6-10-6m20-2-10 6-10-6",
  clipboard: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z",
  chart: "M3 3v18h18M18 17V9M13 17V5M8 17v-3",
  flask: "M9 2v6L3.5 19A2 2 0 0 0 5.2 22h13.6a2 2 0 0 0 1.7-3L15 8V2M8 2h8M7 15h10",
  fileText: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M16 13H8M16 17H8M10 9H8",
  sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  palette: "M12 22a10 10 0 1 1 0-20c5.5 0 10 4 10 9 0 3-2.5 4-4.5 4H15a2 2 0 0 0-2 2c0 1 .5 1.5.5 2.5S13 22 12 22ZM7.5 11.5h.01M10 7.5h.01M14.5 7.5h.01M17 11.5h.01",
  lock: "M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2Zm-3 0V7a4 4 0 0 0-8 0v4",
  unlock: "M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2Zm-3 0V7a4 4 0 0 1 7.7-1.3",
  calendar: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
  moreVertical: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm0-7a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm0 14a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  store: "M3 9 4.5 3h15L21 9M3 9v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9M3 9h18M9 22V13h6v9",
  percent: "M19 5 5 19M6.5 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm11 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  gift: "M20 12v10H4V12M2 7h20v5H2V7Zm10 15V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7Zm0 0h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7Z",
  trophy: "M6 9H4.5a2.5 2.5 0 0 1 0-5H6m12 5h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17a2 2 0 0 1-2 2m8-4.34V17a2 2 0 0 0 2 2m-6-4.34V17M8 2h8v7a4 4 0 1 1-8 0V2Z",
  loader: "M12 2v4m0 12v4M4.9 4.9l2.9 2.9m8.4 8.4 2.9 2.9M2 12h4m12 0h4M4.9 19.1l2.9-2.9m8.4-8.4 2.9-2.9",
  camera: "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2v11Zm-11-3a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.8-1.7",
  wifiOff: "M1 1l22 22M16.7 13.3a11 11 0 0 0-4.5-1.3M5 12.5a11 11 0 0 1 5.2-3M8.5 16.4a6 6 0 0 1 7 0M2 8.8A16 16 0 0 1 8 5.4m4.5-1.3A16 16 0 0 1 22 8.8M12 20h.01",
  receipt: "M4 2v20l2-1.5 2 1.5 2-1.5 2 1.5 2-1.5 2 1.5 2-1.5 2 1.5V2H4Zm12 7H8m8 4H8m4 4H8",
  wallet: "M20 12V8H6a2 2 0 0 1 0-4h12v4M4 6v12a2 2 0 0 0 2 2h14v-4M18 12a2 2 0 0 0 0 4h4v-4h-4Z",
  trendingUp: "m23 6-9.5 9.5-5-5L1 18M17 6h6v6",
  userCheck: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm5 4 2 2 4-4",
  circleDot: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-6a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  send: "m22 2-7 20-4-9-9-4 20-7Z",
  paperclip: "m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48",
  monitor: "M20 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2ZM8 21h8M12 17v4",
  smartphone: "M17 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2ZM12 18h.01",
  tablet: "M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2ZM12 18h.01",
  rr: "M12 2v20M2 12h20",
};

export type EmblemSize = "xs" | "sm" | "md" | "lg" | "xl";

export type IconProps = SVGProps<SVGSVGElement> & {
  name: IconName;
  size?: number;
  /** Ícones preenchidos (estrela marcada) usam fill em vez de stroke. */
  filled?: boolean;
  label?: string;
};

export function Icon({ name, size = 20, filled = false, label, ...rest }: IconProps) {
  const path = PATHS[name];
  const isFilled = filled || name === "starFilled";

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={isFilled ? "currentColor" : "none"}
      stroke={isFilled ? "none" : "currentColor"}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : "presentation"}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      <path d={path} />
    </svg>
  );
}

/**
 * Emblema da loja — arquivo REAL enviado pelo proprietário, sem alteração de
 * identidade. Servido em WebP (menor) com PNG de fallback.
 *
 * O emblema é dourado sobre fundo transparente: ele PRECISA de um fundo escuro
 * para ter contraste. Em superfícies claras, use-o dentro de um chip escuro.
 */
export function StoreLogo({
  className,
  alt,
  style,
  size = 48,
}: {
  className?: string;
  alt?: string;
  style?: CSSProperties;
  size?: number;
}) {
  return (
    <picture style={{ display: "contents" }}>
      <source srcSet="/logo.webp" type="image/webp" />
      <img
        src="/logo.png"
        alt={alt ?? "MA STORE"}
        className={className}
        style={style}
        width={size}
        height={size}
        decoding="async"
      />
    </picture>
  );
}

/**
 * Lockup da marca: emblema + nome escrito em texto real.
 *
 * Motivo: o emblema tem muito detalhe (assinatura e tagline dentro do anel) e
 * ficaria ilegível em 44 px. Combinando o emblema original com o nome em texto,
 * a marca fica nítida em qualquer tamanho, continua selecionável e acessível.
 * O nome e a assinatura vêm da própria identidade da loja — nada inventado.
 */
const EMBLEM_PX: Record<EmblemSize, number> = { xs: 34, sm: 40, md: 48, lg: 72, xl: 168 };

export function StoreLockup({
  onLight,
  showTagline = true,
  emblemSize = "md",
  className,
}: {
  onLight?: boolean;
  showTagline?: boolean;
  /* Tamanho por CLASSE (não por estilo inline) para que as media queries
     possam ajustar o emblema sem precisar de `!important`. */
  emblemSize?: EmblemSize;
  className?: string;
}) {
  return (
    <span className={["store-lockup", className ?? ""].filter(Boolean).join(" ")}>
      <StoreLogo
        className={`store-lockup__emblem store-lockup__emblem--${emblemSize}`}
        /* O nome acessível está no texto ao lado — evita leitura duplicada. */
        alt=""
        size={EMBLEM_PX[emblemSize]}
      />
      <span className={["wordmark", onLight ? "wordmark--on-light" : ""].filter(Boolean).join(" ")}>
        <span className="wordmark__name">MA STORE</span>
        {showTagline ? <span className="wordmark__tag">Qualidade · Confiança · Exclusividade</span> : null}
      </span>
    </span>
  );
}
