import { Delivery, DeliveryLocation, DeliveryZone, Mission, NationalRoute, TransporterUser } from '../../types';
import { addRevenueToSession } from '../store/session';
import {
  getAllPendingDeliveries,
  updateLocalDelivery,
  setLocalActiveMission,
  getLocalActiveMission,
  clearLocalActiveMission,
} from '../store/localStore';
import { HAS_SUPABASE, supabase } from '../lib/supabase';
import { rowToDelivery } from './deliveries';

const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  Dakar:         { lat: 14.6937, lng: -17.4441 },
  Thiès:         { lat: 14.7908, lng: -16.9260 },
  Diourbel:      { lat: 14.6528, lng: -16.2310 },
  Touba:         { lat: 14.8652, lng: -15.8833 },
  Kaolack:       { lat: 14.1652, lng: -16.0757 },
  'Saint-Louis': { lat: 16.0368, lng: -16.5164 },
  Tambacounda:   { lat: 13.7707, lng: -13.6673 },
  Ziguinchor:    { lat: 12.5681, lng: -16.2719 },
  Matam:         { lat: 15.6560, lng: -13.2550 },
  Kédougou:      { lat: 12.5561, lng: -12.1747 },
};

const ROUTE_ORDERED_CITIES: Record<NationalRoute, string[]> = {
  RN1: ['Dakar', 'Thiès', 'Diourbel', 'Kaolack', 'Ziguinchor'],
  RN2: ['Dakar', 'Saint-Louis', 'Matam', 'Tambacounda'],
  RN3: ['Dakar', 'Thiès', 'Touba', 'Tambacounda', 'Kédougou'],
};

const ROUTE_KM: Record<NationalRoute, number>           = { RN1: 460, RN2: 810, RN3: 700 };
const ROUTE_DURATION_MIN: Record<NationalRoute, number> = { RN1: 480, RN2: 840, RN3: 720 };

function isRegional(delivery: Delivery, route: NationalRoute): boolean {
  const cities = ROUTE_ORDERED_CITIES[route];
  const oi = cities.indexOf(delivery.origin.city);
  const di = cities.indexOf(delivery.destination.city);
  if (oi === -1 || di === -1) return false;
  return Math.abs(di - oi) <= 1;
}

function isRegionalOnAnyRoute(delivery: Delivery): boolean {
  return (['RN1', 'RN2', 'RN3'] as NationalRoute[]).some(r => isRegional(delivery, r));
}

function filterByZone(deliveries: Delivery[], route: NationalRoute | undefined, zone: DeliveryZone): Delivery[] {
  if (zone === 'both') return deliveries;
  if (zone === 'regional') return deliveries.filter(d => route ? isRegional(d, route) : isRegionalOnAnyRoute(d));
  return deliveries.filter(d => route ? !isRegional(d, route) : !isRegionalOnAnyRoute(d));
}

function buildMission(deliveries: Delivery[], route: NationalRoute, missionId?: string): Mission {
  const citiesUsed = new Set<string>();
  citiesUsed.add('Dakar');
  deliveries.forEach(d => { citiesUsed.add(d.origin.city); citiesUsed.add(d.destination.city); });

  let optimizedRoute: DeliveryLocation[] = ROUTE_ORDERED_CITIES[route]
    .filter(c => citiesUsed.has(c))
    .map(c => {
      const asOrigin = deliveries.find(d => d.origin.city === c);
      const asDest   = deliveries.find(d => d.destination.city === c);
      return { city: c, address: asOrigin?.origin.address || asDest?.destination.address || '', coordinates: CITY_COORDS[c] ?? { lat: 0, lng: 0 } };
    });

  if (optimizedRoute.length < 2) {
    const dest = deliveries[0]?.destination;
    if (dest) optimizedRoute.push({ ...dest, coordinates: CITY_COORDS[dest.city] ?? { lat: 0, lng: 0 } });
  }

  return {
    id: missionId ?? `mission-${route}-${Date.now()}`,
    deliveries, route, status: 'available',
    totalPrice: deliveries.reduce((sum, d) => sum + d.price, 0),
    optimizedRoute,
    estimatedDuration: ROUTE_DURATION_MIN[route],
    distance: ROUTE_KM[route],
  };
}

export async function getAvailableMissions(
  route: NationalRoute | undefined,
  zone: DeliveryZone = 'both',
  vehicleType?: string,
): Promise<Mission[]> {
  let deliveries: Delivery[] = [];
  let fromCloud = false;

  if (HAS_SUPABASE) {
    try {
      let q = supabase.from('deliveries').select('*').eq('status', 'pending').is('transporter_id', null);
      if (route) q = q.eq('route', route);
      const { data, error } = await q;
      if (!error && data) { deliveries = data.map(rowToDelivery); fromCloud = true; }
      else throw new Error('table absente');
    } catch { fromCloud = false; }
  }

  if (!fromCloud) {
    deliveries = getAllPendingDeliveries();
    if (route) deliveries = deliveries.filter(d => d.route === route);
  }

  deliveries = filterByZone(deliveries, route, zone);
  if (vehicleType) deliveries = deliveries.filter(d => !d.preferredVehicle || d.preferredVehicle === vehicleType);
  if (deliveries.length === 0) return [];

  if (!route) {
    const byRoute = new Map<NationalRoute, Delivery[]>();
    deliveries.forEach(d => {
      const existing = byRoute.get(d.route) ?? [];
      byRoute.set(d.route, [...existing, d]);
    });
    return Array.from(byRoute.entries()).map(([r, ds]) => buildMission(ds, r));
  }

  return [buildMission(deliveries, route)];
}

export async function getActiveMission(transporterId: string, route?: NationalRoute): Promise<Mission | null> {
  if (HAS_SUPABASE) {
    const { data } = await supabase
      .from('deliveries').select('*')
      .eq('transporter_id', transporterId)
      .in('status', ['confirmed', 'in_transit', 'out_for_delivery']);
    if (!data || data.length === 0) return null;
    const deliveries = data.map(rowToDelivery);
    const missionRoute = route ?? deliveries[0].route;
    return { ...buildMission(deliveries, missionRoute), status: 'in_progress', transporterId };
  }
  return getLocalActiveMission(transporterId);
}

export async function acceptMission(mission: Mission, transporter: TransporterUser): Promise<boolean> {
  const ids = mission.deliveries.map(d => d.id);
  const updates = {
    status: 'confirmed' as const,
    transporterId:   transporter.id,
    transporterName: transporter.name,
    transporterPhone: transporter.phone,
  };

  if (HAS_SUPABASE) {
    try {
      const { error } = await supabase
        .from('deliveries')
        .update({ status: 'confirmed', transporter_id: transporter.id, transporter_name: transporter.name, transporter_phone: transporter.phone })
        .in('id', ids);
      if (error) throw error;
    } catch {
      ids.forEach(id => updateLocalDelivery(id, updates));
    }
  } else {
    ids.forEach(id => updateLocalDelivery(id, updates));
  }

  const activeMission: Mission = {
    ...mission,
    id: `active-${transporter.id}-${Date.now()}`,
    status: 'in_progress',
    transporterId: transporter.id,
    deliveries: mission.deliveries.map(d => ({ ...d, ...updates })),
  };
  setLocalActiveMission(transporter.id, activeMission);
  addRevenueToSession(transporter.id, mission.totalPrice);
  return true;
}

export async function completeMission(transporterId: string): Promise<void> {
  const mission = getLocalActiveMission(transporterId);
  if (mission) {
    const ids = mission.deliveries.map(d => d.id);
    if (HAS_SUPABASE) {
      await supabase.from('deliveries').update({ status: 'delivered' }).in('id', ids);
    } else {
      ids.forEach(id => updateLocalDelivery(id, { status: 'delivered' }));
    }
  }
  clearLocalActiveMission(transporterId);
}