import { PlaceholderScene } from './PlaceholderScene';

export class StationScene extends PlaceholderScene {
  protected readonly title = 'Станция';
  protected readonly hint = 'Появится на этапе 5';

  constructor() {
    super('StationScene');
  }
}
