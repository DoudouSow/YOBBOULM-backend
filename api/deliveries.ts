import { supabase } from '../lib/supabase';
import { Delivery, DeliveryStatus, NationalRoute, PackageType, PaymentMethod } from '../../types';

export type CreateDeliveryInput = {
  senderId: string;
  senderName: string;
  recipientPhone: string;
  recipientName: string;
  originCity: string;
  originAddress: string;
  destinationCity: string;
  destinationAddress: string;
  packageType: PackageType;
  weight: number;
  price: number;
  paymentMethod: PaymentMethod;
  route: NationalRoute;
  preferredVehicle?: string;
  notes?: string;
};

export async function fetchMyDeliveries(senderId: string): Promise<Delivery[]> {
  const { data, error } = await supabase
    .from('deliveries')
    .select('*')
    .eq('sender_id', senderId)
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return data.map(rowToDelivery);
}

export async function createDelivery(input: CreateDeliveryInput): Promise<Delivery | null> {
  const { data, error } = await supabase
    .from('deliveries')
    .insert({
      sender_id:           input.senderId,
      sender_name:         input.senderName,
      recipient_phone:     input.recipientPhone,
      recipient_name:      input.recipientName,
      origin_city:         input.originCity,
      origin_address:      input.originAddress,
      destination_city:    input.destinationCity,
      destination_address: input.destinationAddress,
      package_type:        input.packageType,
      weight:              input.weight,
      price:               input.price,
      payment_method:      input.paymentMethod,
      payment_status:      'paid',
      route:               input.route,
      preferred_vehicle:   input.preferredVehicle ?? null,
      notes:               input.notes ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error('[createDelivery] Supabase error:', error.message, error.details, error.hint);
    return null;
  }
  if (!data) return null;
  return rowToDelivery(data);
}

export async function updateDeliveryStatus(id: string, status: DeliveryStatus): Promise<boolean> {
  const { error } = await supabase
    .from('deliveries')
    .update({
      status,
      ...(status === 'delivered' ? { delivered_at: new Date().toISOString() } : {}),
    })
    .eq('id', id);
  return !error;
}

export function subscribeToNewDeliveries(route: string, onNew: () => void) {
  return supabase
    .channel(`new-deliveries:${route}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'deliveries', filter: `route=eq.${route}` },
      () => onNew()
    )
    .subscribe();
}

export async function subscribeToDelivery(id: string, onUpdate: (d: Delivery) => void) {
  return supabase
    .channel(`delivery:${id}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'deliveries', filter: `id=eq.${id}` },
      (payload) => onUpdate(rowToDelivery(payload.new as Record<string, unknown>))
    )
    .subscribe();
}

export function rowToDelivery(r: Record<string, unknown>): Delivery {
  return {
    id:               r.id as string,
    senderId:         r.sender_id as string,
    senderName:       r.sender_name as string,
    recipientPhone:   r.recipient_phone as string,
    recipientName:    r.recipient_name as string,
    origin: {
      city:        r.origin_city as string,
      address:     (r.origin_address as string) ?? '',
      coordinates: { lat: 0, lng: 0 },
    },
    destination: {
      city:        r.destination_city as string,
      address:     (r.destination_address as string) ?? '',
      coordinates: { lat: 0, lng: 0 },
    },
    packageType:      r.package_type as PackageType,
    weight:           Number(r.weight),
    status:           r.status as DeliveryStatus,
    transporterId:    (r.transporter_id as string) ?? undefined,
    transporterName:  (r.transporter_name as string) ?? undefined,
    transporterPhone: (r.transporter_phone as string) ?? undefined,
    route:            r.route as NationalRoute,
    preferredVehicle: (r.preferred_vehicle as string) ?? undefined,
    price:            r.price as number,
    paymentMethod:    (r.payment_method as PaymentMethod) ?? undefined,
    paymentStatus:    r.payment_status as 'pending' | 'paid',
    createdAt:        r.created_at as string,
    estimatedDelivery:(r.estimated_delivery as string) ?? undefined,
    deliveredAt:      (r.delivered_at as string) ?? undefined,
    trackingCode:     r.tracking_code as string,
    gpsPosition: r.gps_lat
      ? { lat: Number(r.gps_lat), lng: Number(r.gps_lng), timestamp: r.gps_updated_at as string, isDirect: true }
      : undefined,
    rating: (r.rating as number) ?? undefined,
    notes:  (r.notes as string) ?? undefined,
  };
}