import { urlDomainMarks } from './url-marks';

describe('urlDomainMarks (D-181): pierwszy pojedynczy „/” i druga „.” na lewo od niego', () => {
  it('adres z modułu 1: domena formularz-online.net, nie poddomena fundacji', () => {
    const url = 'https://fundacja-analityki.formularz-online.net/prelegenci/48213';
    const marks = urlDomainMarks(url);
    expect(marks).not.toBeNull();
    expect(marks!.domain).toBe('formularz-online.net');
    expect(url[marks!.slash]).toBe('/');
    expect(url.slice(0, marks!.slash)).toBe('https://fundacja-analityki.formularz-online.net');
    expect(url[marks!.dot]).toBe('.');
    expect(url.slice(0, marks!.dot)).toBe('https://fundacja-analityki');
  });

  it('ukośniki z „https://” nie są pierwszym pojedynczym ukośnikiem; adres bez schematu też działa', () => {
    expect(urlDomainMarks('http://a.b.c.example.pl/x//y')?.domain).toBe('example.pl');
    expect(urlDomainMarks('sklep.przyklad.com/koszyk')?.domain).toBe('przyklad.com');
  });

  it('brak ukośnika po nazwie strony albo za mało kropek - null (reguły nie da się zastosować)', () => {
    expect(urlDomainMarks('https://fundacja.example.net')).toBeNull();
    expect(urlDomainMarks('https://example.net/a')).toBeNull();
    expect(urlDomainMarks('https:///a.b.c')).toBeNull();
    expect(urlDomainMarks('')).toBeNull();
  });

  it('adresy, dla których reguła dałaby złą odpowiedź - null: domeny typu com.pl/co.uk, port, ?, #, @, puste etykiety', () => {
    expect(urlDomainMarks('https://bank.com.pl/logowanie')).toBeNull();
    expect(urlDomainMarks('https://www.sklep.co.uk/koszyk')).toBeNull();
    expect(urlDomainMarks('https://a.b.pl:8080/x')).toBeNull();
    expect(urlDomainMarks('https://a.b.pl?x=1/y')).toBeNull();
    expect(urlDomainMarks('https://a.b.pl#c/d')).toBeNull();
    expect(urlDomainMarks('https://bank.pl@zly.przyklad.net/x')).toBeNull();
    expect(urlDomainMarks('https://a..b.pl/x')).toBeNull();
  });
});
