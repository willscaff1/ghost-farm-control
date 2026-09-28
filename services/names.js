// Padrão de nome e vulgo da família: cada palavra com a primeira letra
// maiúscula e o resto minúscula ("zé DA silva" -> "Zé Da Silva").
function toTitleCase(value) {
    const s = String(value ?? '').trim().replace(/\s+/g, ' ');
    if (!s) return '';
    return s.split(' ').map(word =>
        word.split('-').map(part =>
            part ? part.charAt(0).toLocaleUpperCase('pt-BR') + part.slice(1).toLocaleLowerCase('pt-BR') : part
        ).join('-')
    ).join(' ');
}

module.exports = { toTitleCase };
