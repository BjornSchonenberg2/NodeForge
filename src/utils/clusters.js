export const DEFAULT_CLUSTERS = [
  "AV",
  "IT",
  "CCTV",
  "Audio",
  "Video",
  "LAN",
  "WAN",
  "Power",
  "Control",
];
export const clusterColor = (name) =>
  ({
    AV: "#50E3C2",
    IT: "#4A90E2",
    CCTV: "#7E57C2",
    Audio: "#F5A623",
    Video: "#56CCF2",
    LAN: "#27AE60",
    WAN: "#16A085",
    Power: "#FF6677",
    Control: "#B8E986",
  }[name] || "#9AA7B2");
