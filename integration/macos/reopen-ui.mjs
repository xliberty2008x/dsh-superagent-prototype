import {requestBrowserHandoff} from '../../native-openai-ui/browser-handoff.mjs';
const [file,pid]=process.argv.slice(2);const value=Number(pid);
if(!file||!Number.isSafeInteger(value)||value<=0)process.exit(2);
const opened=await requestBrowserHandoff(file,value);
if(!opened){console.error('Не вдалося повторно відкрити цей сервер. Зупини попередній запуск у його Terminal через Ctrl+C і запусти launcher знову.');process.exit(1);}
console.log('Браузер відкрито через штатну вебавторизацію DSH.');
