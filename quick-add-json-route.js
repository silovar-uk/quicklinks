(() => {
  const button = document.getElementById('openJsonImportBtn');
  if (!button) return;

  button.addEventListener('click', () => {
    closeModal('quickUrlModal');
    state.activeTab = 'settings';
    save();
    render();

    setTimeout(() => {
      const input = document.getElementById('importText');
      const target = input?.closest('.settings-card') || input;
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => input?.focus({ preventScroll: true }), 180);
      toast('JSONファイル選択、またはJSON貼り付けでまとめて取り込めます');
    }, 80);
  });
})();
