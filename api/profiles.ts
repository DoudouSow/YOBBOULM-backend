import { supabase } from '../lib/supabase';
import { User, UserRole, DeliveryZone } from '../../types';

export async function fetchProfile(userId: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error || !data) return null;
  return rowToUser(userId, data);
}

export async function incrementBalance(userId: string, delta: number): Promise<boolean> {
  const { data } = await supabase
    .from('profiles')
    .select('balance')
    .eq('id', userId)
    .single();

  if (!data) return false;

  const { error } = await supabase
    .from('profiles')
    .update({ balance: data.balance + delta })
    .eq('id', userId);

  return !error;
}

function rowToUser(id: string, r: Record<string, unknown>): User {
  const base = {
    id,
    name: r.name as string,
    phone: r.phone as string,
    role: r.role as UserRole,
    isActive: r.is_active as boolean,
    createdAt: r.created_at as string,
  };

  if (r.role === 'transporter') {
    return {
      ...base,
      role: 'transporter',
      vehicleType:     (r.vehicle_type as string)   ?? '',
      vehiclePlate:    (r.vehicle_plate as string)  ?? '',
      route:           (r.route as 'RN1' | 'RN2' | 'RN3') ?? 'RN1',
      deliveryZone:    ((r.delivery_zone as DeliveryZone) ?? 'both'),
      isValidated:     r.is_validated as boolean,
      isPremium:       r.is_premium as boolean,
      rating:          Number(r.rating ?? 5),
      totalDeliveries: r.total_deliveries as number,
      balance:         r.balance as number,
    };
  }
  if (r.role === 'recipient') return { ...base, role: 'recipient' };
  if (r.role === 'admin')     return { ...base, role: 'admin' };
  return { ...base, role: 'sender', balance: r.balance as number };
}