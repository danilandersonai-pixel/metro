import { PlaceholderScene } from './PlaceholderScene';

export class QuestDialogScene extends PlaceholderScene {
  protected readonly title = 'Диалог квеста';
  protected readonly hint = 'Появится на этапе 7';

  constructor() {
    super('QuestDialogScene');
  }
}
