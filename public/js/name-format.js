// Nome e vulgo no padrão da família: Primeira Maiúscula em cada palavra.
// Formata ao sair do campo; o backend aplica a mesma regra ao salvar.
(function () {
    function toTitleCase(value) {
        const s = String(value ?? '').trim().replace(/\s+/g, ' ');
        if (!s) return '';
        return s.split(' ').map(word =>
            word.split('-').map(part =>
                part ? part.charAt(0).toLocaleUpperCase('pt-BR') + part.slice(1).toLocaleLowerCase('pt-BR') : part
            ).join('-')
        ).join(' ');
    }
    const IDS = ['name', 'newName', 'editMemberName', 'editMemberCapitalNickname', 'editName', 'editCapitalNickname', 'capitalNicknameInput'];
    function bind(el) {
        if (!el || el.dataset.titleCaseBound) return;
        el.dataset.titleCaseBound = '1';
        el.addEventListener('blur', () => { el.value = toTitleCase(el.value); });
    }
    function scan() { IDS.forEach(id => bind(document.getElementById(id))); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan); else scan();
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
    window.toTitleCase = toTitleCase;
})();
