import { describe, expect, it } from 'vitest';
import { sceneZoom, sceneZoomStyle } from './scene-zoom';

// Po transformie punkt p (px, układ strony) trafia w: origin + translate + (p - origin) * scale, gdzie origin w układzie strony = image.left/top + origin.
function project(zoom: ReturnType<typeof sceneZoom>, image: { left: number; top: number }, x: number, y: number) {
  const ox = image.left + zoom.originX;
  const oy = image.top + zoom.originY;
  return { x: ox + zoom.translateX + (x - ox) * zoom.scale, y: oy + zoom.translateY + (y - oy) * zoom.scale };
}

describe('sceneZoom (kamera sceny, D-086)', () => {
  const image = { left: 100, top: 50, width: 1000, height: 625 };
  const view = image;

  it('mały przedmiot: skala do ~70% widoku w ciaśniejszym wymiarze, środek przedmiotu na środku widoku', () => {
    const item = { left: 700, top: 100, width: 100, height: 200 };
    const zoom = sceneZoom(item, image, view);
    expect(zoom.scale).toBeCloseTo((625 * 0.7) / 200, 5); // wysokość jest ciaśniejsza: 437.5/200 = 2.19
    const center = project(zoom, image, 750, 200);
    expect(center.x).toBeCloseTo(600, 5);
    expect(center.y).toBeCloseTo(362.5, 5);
    // Przedmiot po przybliżeniu ma 70% wysokości widoku.
    const top = project(zoom, image, 750, 100);
    const bottom = project(zoom, image, 750, 300);
    expect((bottom.y - top.y) / view.height).toBeCloseTo(0.7, 5);
  });

  it('skala ograniczona do [1, 4]: maleńki przedmiot - 4, przedmiot większy niż cel - 1 (tylko wyśrodkowanie)', () => {
    expect(sceneZoom({ left: 500, top: 300, width: 10, height: 10 }, image, view).scale).toBe(4);
    const big = sceneZoom({ left: 150, top: 60, width: 900, height: 600 }, image, view);
    expect(big.scale).toBe(1);
    expect(project(big, image, 600, 360).x).toBeCloseTo(600, 5);
  });

  it('telefon w pionie: obraz szerszy i przesunięty względem widoku (panorama) - przedmiot trafia na środek WIDOKU, nie obrazu', () => {
    const wideImage = { left: -600, top: 100, width: 1400, height: 875 };
    const phoneView = { left: 0, top: 100, width: 390, height: 875 };
    const item = { left: 250, top: 400, width: 60, height: 120 };
    const zoom = sceneZoom(item, wideImage, phoneView);
    const center = project(zoom, wideImage, 280, 460);
    expect(center.x).toBeCloseTo(195, 5);
    expect(center.y).toBeCloseTo(537.5, 5);
    expect(zoom.scale).toBeCloseTo(Math.min(4, (390 * 0.7) / 60, (875 * 0.7) / 120), 5);
  });

  it('sceneZoomStyle: origin w px względem obrazu, translate w px, zaokrąglenie do 0.01', () => {
    const style = sceneZoomStyle({ originX: 650.123, originY: 150, translateX: -150.556, translateY: 212.5, scale: 2.1875 });
    expect(style).toEqual({ transformOrigin: '650.12px 150px', transform: 'translate(-150.56px, 212.5px) scale(2.19)' });
  });
});
