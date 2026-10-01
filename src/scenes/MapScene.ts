import { PlaceholderScene } from './PlaceholderScene';

export class MapScene extends PlaceholderScene {
  protected readonly title = 'Глобальная карта';
  protected readonly hint = 'Появится на этапе 4';

  constructor() {
    super('MapScene');
  }
}
