import { Routes } from '@angular/router';
import { ChatPageComponent } from './pages/chat/chat-page.component';

export const routes: Routes = [
  { path: 'chat/:id', component: ChatPageComponent },
  {
    // Thread diagnostic: what the model REALLY received and produced.
    path: 'debug/prompt',
    loadComponent: () =>
      import('./pages/debug/debug-prompt.component').then((m) => m.DebugPromptComponent),
  },
  {
    path: 'debug/artefacts',
    loadComponent: () =>
      import('./pages/debug/debug-artefacts.component').then((m) => m.DebugArtefactsComponent),
  },
  {
    // Every state of the mascot, in the real component, without a model.
    path: 'debug/mascotte',
    loadComponent: () =>
      import('./pages/debug/debug-mascotte.component').then((m) => m.DebugMascotteComponent),
  },
  { path: '', component: ChatPageComponent },
  { path: '**', redirectTo: '' },
];
