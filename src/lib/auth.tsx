import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, Profile } from './supabase';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, name: string, role: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchProfile(userId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*, company_is_approved:companies!left(is_approved)')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      console.error('Error fetching profile:', error);
      return;
    }
    if (data) {
      // Flatten the company_is_approved from the left join
      const d = data as any;
      const flat = {
        ...d,
        company_is_approved: d.companies?.is_approved ?? null,
      };
      delete flat.companies;
      setProfile(flat as Profile);
    }
  }

  async function ensureProfile(u: User) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, role, company_id')
      .eq('id', u.id)
      .maybeSingle();

    if (error) console.error('Error checking profile:', error);

    const isAdmin = u.email === 'traceqr@gmail.com';
    const displayName = u.user_metadata?.full_name ?? u.user_metadata?.name ?? u.email?.split('@')[0] ?? 'Usuario';
    const role = isAdmin ? 'admin' : (u.user_metadata?.role ?? 'student');

    let companyId: string | null = null;

    // Auto-link company users to their company by email
    if (role === 'company' && u.email) {
      const { data: company } = await supabase
        .from('companies')
        .select('id')
        .eq('email', u.email)
        .maybeSingle();
      if (company) {
        companyId = company.id;
      }
    }

    if (!data) {
      const { error: insertError } = await supabase.from('profiles').insert({
        id: u.id,
        email: u.email ?? '',
        display_name: displayName,
        role,
        company_id: companyId,
        avatar_url: u.user_metadata?.avatar_url ?? null,
      });
      if (insertError) console.error('Error creating profile:', insertError);
    } else {
      const updates: Record<string, unknown> = {};
      if (!data.display_name) updates.display_name = displayName;
      if (companyId && !data.company_id) updates.company_id = companyId;
      if (Object.keys(updates).length > 0) {
        await supabase.from('profiles').update(updates).eq('id', u.id);
      }
    }
    await fetchProfile(u.id);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        (async () => {
          await ensureProfile(session.user);
          setLoading(false);
        })();
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        (async () => {
          await ensureProfile(session.user);
        })();
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message.toLowerCase().includes('invalid login credentials') || error.message.toLowerCase().includes('invalid')) {
        return { error: 'Correo o contraseña incorrectos' };
      }
      if (error.message.toLowerCase().includes('email not confirmed')) {
        return { error: 'Por favor confirma tu correo antes de iniciar sesión' };
      }
      return { error: error.message };
    }
    return { error: null };
  }

  async function signUp(email: string, password: string, name: string, role: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name, role } },
    });
    if (error) {
      if (error.message.toLowerCase().includes('already registered') || error.message.toLowerCase().includes('already exists')) {
        return { error: 'Este correo ya está registrado. Inicia sesión con tu cuenta.' };
      }
      return { error: error.message };
    }
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      return { error: 'Este correo ya está registrado. Inicia sesión con tu cuenta.' };
    }
    if (data.user) {
      await supabase.from('profiles').upsert({
        id: data.user.id,
        email,
        display_name: name,
        role,
      });
    }
    return { error: null };
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.href.split('?')[0].split('#')[0],
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) return { error: error.message };
    return { error: null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
  }

  async function refreshProfile() {
    if (user) await fetchProfile(user.id);
  }

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, signIn, signUp, signInWithGoogle, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
