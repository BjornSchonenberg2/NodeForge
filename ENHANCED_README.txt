Upgrade: Enhanced Node Lab

Added:
- Animated wireframe reveal (fade-in edges overlay when toggling wireframe)
- Node types (Device, Light, Switch, Access Point)
- One-click "Connect Switch ➜ Devices" fan-out animation
- Type selectors in "Add Node" and "Inspector" panels

How to apply:
1) Replace src/Interactive3DNodeShowcase.jsx with the enhanced file:
   /mnt/data/Interactive3DNodeShowcase.enhanced.jsx

2) Your App already imports the showcase via:
   import EpicShowcaseApp from './Interactive3DNodeShowcase';
   export default function App() { return <EpicShowcaseApp />; }

3) Run: npm start

Notes:
- The wireframe toggle now animates via a white edges overlay for extra pop.
- Mark a node as a Switch or Device, then use "Signals → Connect Switch ➜ Devices" to auto-animate wavy links
  from every switch to every device. It respects the cluster legend filter.