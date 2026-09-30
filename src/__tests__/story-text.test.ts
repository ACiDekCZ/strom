import { describe, it, expect } from 'vitest';
import { storyProseHtml } from '../story-text.js';

describe('storyProseHtml', () => {
    it('paragraphs, line breaks and bold as before', () => {
        expect(storyProseHtml('Byl **nádeník**.\nV čp. 13.\n\n\nDruhý.'))
            .toBe('<p>Byl <strong>nádeník</strong>.<br>V čp. 13.</p><p>Druhý.</p>');
    });

    it('escapes everything first', () => {
        expect(storyProseHtml('A <script>x</script> & "b"')).toBe('<p>A &lt;script&gt;x&lt;/script&gt; &amp; &quot;b&quot;</p>');
        expect(storyProseHtml('## <b>X</b>')).toBe('<h4 class="story-subhead">&lt;b&gt;X&lt;/b&gt;</h4>');
    });

    it('## lines are subheadings, even without blank lines around them', () => {
        expect(storyProseHtml('## Narození v Pecínově (1831)\nAnna se narodila.\n### Křest\nTýž den.'))
            .toBe('<h4 class="story-subhead">Narození v Pecínově (1831)</h4><p>Anna se narodila.</p>'
                + '<h5 class="story-subhead">Křest</h5><p>Týž den.</p>');
        expect(storyProseHtml('## Oddíl', { headingLevel: 5 })).toBe('<h5 class="story-subhead">Oddíl</h5>');
    });

    it('a leading # line repeating the title is left out; a different one stays', () => {
        const title = 'Anna Konopásková, rozená Widmannová (1831)';
        expect(storyProseHtml(`# ${title}\n\nText.`, { title })).toBe('<p>Text.</p>');
        expect(storyProseHtml('# **anna konopásková, rozená widmannová (1831).**\nText.', { title })).toBe('<p>Text.</p>');
        expect(storyProseHtml('# Jiný nadpis\n\nText.', { title })).toBe('<h4 class="story-subhead">Jiný nadpis</h4><p>Text.</p>');
        expect(storyProseHtml(`# ${title}`)).toBe(`<h4 class="story-subhead">${title}</h4>`);
        // Only as the first line.
        expect(storyProseHtml(`Úvod.\n\n# ${title}`, { title })).toContain('story-subhead');
    });

    it('- lines are a list; a line without the dash continues the item', () => {
        expect(storyProseHtml('Děti:\n- **Antonín**, 1853\n- **Josef**, 1854\n  v Rynholci\n\nKonec.'))
            .toBe('<p>Děti:</p><ul><li><strong>Antonín</strong>, 1853</li><li><strong>Josef</strong>, 1854<br>v Rynholci</li></ul><p>Konec.</p>');
    });

    it('the birth mark and a date opening a line are not lists', () => {
        expect(storyProseHtml('* 1831 Pecínov\n1. ledna 1850 se oženil.'))
            .toBe('<p>* 1831 Pecínov<br>1. ledna 1850 se oženil.</p>');
    });

    it('*italic*, but never a birth mark or an asterisk inside a word', () => {
        expect(storyProseHtml('zapsán jako *parentes liberi* v knize')).toBe('<p>zapsán jako <em>parentes liberi</em> v knize</p>');
        expect(storyProseHtml('(*1831) a (*1833)')).toBe('<p>(*1831) a (*1833)</p>');
        expect(storyProseHtml('Jan *1831, bratr *1833')).toBe('<p>Jan *1831, bratr *1833</p>');
        expect(storyProseHtml('a*b*c')).toBe('<p>a*b*c</p>');
        expect(storyProseHtml('**tučně** a *šikmo*')).toBe('<p><strong>tučně</strong> a <em>šikmo</em></p>');
    });

    it('other markdown stays plain text', () => {
        expect(storyProseHtml('[odkaz](http://x) a `kód`')).toBe('<p>[odkaz](http://x) a `kód`</p>');
    });

    it('Windows line ends', () => {
        expect(storyProseHtml('## A\r\nB\r\n\r\nC')).toBe('<h4 class="story-subhead">A</h4><p>B</p><p>C</p>');
    });
});
