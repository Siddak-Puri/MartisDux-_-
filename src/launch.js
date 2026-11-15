import '@fontsource-variable/instrument-sans/wght.css';
import '@fontsource/julius-sans-one/400.css';
import '@fontsource-variable/martian-mono/wght.css';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';
import './workspace.css';
import './mission.css';
import './glass.css';
import './home.css';
import './mission-log.css';
import './loader/loader.css';
import { createLaunch } from './loader/index.js';
import { initializeTheme } from './theme.js';

initializeTheme();
export const boot = createLaunch();
import('./main.js').catch(boot.fail);

