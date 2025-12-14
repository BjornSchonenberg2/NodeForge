export const DEFAULT_CLUSTERS = ["AV", "Lights", "Power", "Network", "Control"];
export const clusterColor = (name) =>
  ({
    AV: "#50E3C2",
    Lights: "#F8E71C",
    Power: "#FF6677",
    Network: "#4A90E2",
    Control: "#B8E986",
  }[name] || "#9AA7B2");
