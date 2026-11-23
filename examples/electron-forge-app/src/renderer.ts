import type { Updates } from '@barrel-kit/sdk-electron';
import './index.css';

const message = document.querySelector<HTMLElement>('#update-state');
const progress =
  document.querySelector<HTMLProgressElement>('#update-progress');
const restart = document.querySelector<HTMLButtonElement>('#apply-update');

if (!message || !progress || !restart)
  throw new Error('Update view is incomplete');

const messages: Record<Updates.State['type'], string> = {
  idle: 'Updates run in the background.',
  checking: 'Checking for updates…',
  available: 'An update is available.',
  downloading: 'Downloading update…',
  downloaded: 'Your update is ready.',
  applying: 'Restarting…',
  'update-cancelled': 'The update was cancelled.',
  failed: 'The update couldn’t be completed. We’ll check again later.',
};

const observeUpdates = async () => {
  const remove = await window.updates.subscribe(({ state }) => {
    message.textContent = messages[state.type];
    restart.hidden = state.type !== 'downloaded';
    progress.hidden = state.type !== 'downloading';
    if (state.type === 'downloading' && state.progress !== undefined)
      progress.value = state.progress;
    else progress.removeAttribute('value');
  });

  window.addEventListener('beforeunload', remove, { once: true });
};

void observeUpdates().catch(() => {
  message.textContent = 'Couldn’t connect to the update service.';
});

restart.addEventListener('click', async () => {
  restart.disabled = true;
  try {
    await window.updates.apply();
  } catch {
    message.textContent = 'The update couldn’t be installed. Please try again.';
  } finally {
    restart.disabled = false;
  }
});
