import { post } from '../api.js';
import { useToast } from '../toast.jsx';
import Menu from './Menu.jsx';

// Moderator shortcuts shown on posts and comments for mods/admins.
export default function ModActions({ kind, target, onChange }) {
  const toast = useToast();
  const run = async (fn, msg) => {
    try {
      await fn();
      toast(msg);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const items = [
    {
      label: target.removed ? 'Restore' : 'Remove', icon: 'shield', danger: !target.removed,
      onClick: () => {
        if (target.removed) return run(() => post('/admin/restore', { kind, id: target.id }), 'Restored').then(() => onChange({ removed: false }));
        const reason = prompt('Removal reason (shown to the author):', 'Breaks the community rules');
        if (reason === null) return undefined;
        return run(() => post('/admin/remove', { kind, id: target.id, reason }), 'Removed').then(() => onChange({ removed: true, removalReason: reason }));
      },
    },
    { label: target.pinned ? 'Unpin' : 'Pin', icon: 'pin', hidden: kind !== 'post', onClick: () => run(() => post(`/posts/${target.id}/pin`, { on: !target.pinned }), target.pinned ? 'Unpinned' : 'Pinned').then(() => onChange({ pinned: !target.pinned })) },
    { label: target.locked ? 'Unlock' : 'Lock', icon: 'lock', hidden: kind !== 'post', onClick: () => run(() => post(`/posts/${target.id}/lock`, { on: !target.locked }), target.locked ? 'Unlocked' : 'Locked').then(() => onChange({ locked: !target.locked })) },
    { label: 'View author', icon: 'user', hidden: !target.mod?.authorId, onClick: () => { window.location.href = `/admin?tab=users&id=${target.mod.authorId}`; } },
  ];
  return <Menu items={items} label="Moderator actions" icon="shield" />;
}
