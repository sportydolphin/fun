import { supabase } from './supabase'

// /admin → Roadmap. Owner-only table (RLS: is_site_owner() for every verb), so every call here
// answers nothing to anyone else. Schema and the reasons for it are in
// scripts/migrations/20261014070000_add_roadmap_items.sql.

export type RoadmapPriority = 'P0' | 'P1' | 'P2' | 'P3' | 'parked'
export type RoadmapArea = 'site' | 'wpbl' | 'mlb'

export interface RoadmapItem {
  id: string
  title: string
  notes: string
  priority: RoadmapPriority
  area: RoadmapArea
  position: number
  done_at: string | null
  created_at: string
  updated_at: string
}

export const PRIORITIES: RoadmapPriority[] = ['P0', 'P1', 'P2', 'P3', 'parked']
export const AREAS: RoadmapArea[] = ['site', 'wpbl', 'mlb']

export async function fetchRoadmap(): Promise<RoadmapItem[] | null> {
  const { data, error } = await supabase.from('roadmap_items').select('*')
    .order('priority').order('position').order('created_at')
  if (error) { console.error('fetchRoadmap:', error); return null }
  return data as RoadmapItem[]
}

export async function addRoadmapItem(row: Pick<RoadmapItem, 'title' | 'notes' | 'priority' | 'area' | 'position'>): Promise<RoadmapItem | null> {
  const { data, error } = await supabase.from('roadmap_items').insert(row).select().single()
  if (error) { console.error('addRoadmapItem:', error); return null }
  return data as RoadmapItem
}

export async function updateRoadmapItem(id: string, patch: Partial<Omit<RoadmapItem, 'id' | 'created_at' | 'updated_at'>>): Promise<boolean> {
  const { error } = await supabase.from('roadmap_items').update(patch).eq('id', id)
  if (error) { console.error('updateRoadmapItem:', error); return false }
  return true
}

export async function deleteRoadmapItem(id: string): Promise<boolean> {
  const { error } = await supabase.from('roadmap_items').delete().eq('id', id)
  if (error) { console.error('deleteRoadmapItem:', error); return false }
  return true
}
