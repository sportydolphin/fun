import { supabase } from '../../lib/supabase'
import { safe, ownerWrite } from './core'

// The live notes the owner has posted (wpbl_note_posts), read only by /admin's Notes console. Not
// cached: the console is the one reader, and a mark it just wrote has to show on the next read.

export interface WpblNotePost {
  note_key: string
  game_id: string
  text: string
  posted_at: string
}

export function fetchWpblNotePosts(): Promise<WpblNotePost[]> {
  return safe('fetchWpblNotePosts', () =>
    supabase.from('wpbl_note_posts').select('note_key,game_id,text,posted_at').order('posted_at', { ascending: false }),
    [] as WpblNotePost[])
}

export function saveWpblNotePost(post: Omit<WpblNotePost, 'posted_at'>): Promise<boolean> {
  return ownerWrite('saveWpblNotePost', () => supabase.from('wpbl_note_posts').insert(post))
}

export function deleteWpblNotePost(key: string): Promise<boolean> {
  return ownerWrite('deleteWpblNotePost', () => supabase.from('wpbl_note_posts').delete().eq('note_key', key))
}
