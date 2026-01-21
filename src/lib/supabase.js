import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://cygrnehctycewvfyqisz.supabase.co'
const supabaseKey = 'sb_publishable_N8Z08knSIS6y1_KQfVWMgw_HGAWbFPq'

export const supabase = createClient(supabaseUrl, supabaseKey)

