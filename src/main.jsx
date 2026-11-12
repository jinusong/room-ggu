import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './styles/app.css';
import { render } from 'preact';
import { App } from './ui/App.jsx';

render(<App />, document.getElementById('app'));
