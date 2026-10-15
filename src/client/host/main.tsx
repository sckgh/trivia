import '@fontsource-variable/montserrat/wght.css';
import { render } from 'preact';
import { App } from './App';
import './host.css';

render(<App />, document.getElementById('app')!);
