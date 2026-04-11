import type { Session, User } from 'better-auth'

// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    // interface Error {}
    interface Locals {
      session: Session | undefined
      user: User | undefined
    }
    interface PageData {
      isGithubEnabled: boolean
    }
    // interface PageState {}
    // interface Platform {}
  }
}

export {}
