import '../css/style.css';
import { render } from '@solidjs/web';
import App from './components/App';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
render(() => <App />, root);
