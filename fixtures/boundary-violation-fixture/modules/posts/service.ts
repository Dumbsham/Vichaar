// Illegal cross-module internal import violating architecture boundary
import { authRepo } from '../auth/repository.js';

export function getAuthorForPost(id: string) {
  return authRepo.findUser(id);
}
