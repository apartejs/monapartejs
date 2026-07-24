import { Routes } from '@angular/router';
import { ChatPageComponent } from './pages/chat/chat-page.component';

export const routes: Routes = [
  { path: 'chat/:id', component: ChatPageComponent },
  { path: '', component: ChatPageComponent },
  { path: '**', redirectTo: '' },
];
