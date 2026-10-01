import { PlaceholderScene } from './PlaceholderScene';

export class BattleScene extends PlaceholderScene {
  protected readonly title = 'Бой';
  protected readonly hint = 'Логика — этап 2, экран — этап 3';

  constructor() {
    super('BattleScene');
  }
}
