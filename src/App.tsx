import { LandingPage } from "./components/LandingPage";
import { Portal } from "./components/Portal";

export default function App() { return window.location.pathname.startsWith("/portal") ? <Portal/> : <LandingPage/>; }
