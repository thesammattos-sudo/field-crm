import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = 'https://cygrnehctycewvfyqisz.supabase.co'
export const supabaseAnonKey = 'sb_publishable_N8Z08knSIS6y1_KQfVWMgw_HGAWbFPq'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

