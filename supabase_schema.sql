-- ============================================================
-- YOBBOULMA SN — Script de création des tables Supabase
-- À exécuter dans l'éditeur SQL de votre projet Supabase
-- ============================================================

-- Extension UUID
create extension if not exists "uuid-ossp";

-- ── Utilisateurs (tous rôles) ────────────────────────────────
create table if not exists utilisateurs (
  id            uuid primary key default uuid_generate_v4(),
  nom           text not null,
  prenom        text not null,
  telephone     text not null,
  email         text unique not null,
  mot_de_passe  text not null,
  role          text not null check (role in ('expediteur','destinataire','transporteur','admin')),
  route_nationale text check (route_nationale in ('RN1','RN2','RN3')),
  statut_validation boolean default false,
  fcm_token     text,
  created_at    timestamptz default now()
);

-- ── Tokens révoqués (déconnexion) ───────────────────────────
create table if not exists tokens_revoques (
  id        bigint generated always as identity primary key,
  token     text unique not null,
  expire_le timestamptz not null,
  created_at timestamptz default now()
);

-- ── Colis ───────────────────────────────────────────────────
create table if not exists colis (
  id               uuid primary key default uuid_generate_v4(),
  expediteur_id    uuid references utilisateurs(id),
  destinataire_id  uuid references utilisateurs(id),
  transporteur_id  uuid references utilisateurs(id),
  description      text not null,
  poids_kg         numeric not null,
  volume_m3        numeric,
  adresse_collecte text,
  adresse_livraison text,
  lat_collecte     numeric,
  lng_collecte     numeric,
  lat_livraison    numeric,
  lng_livraison    numeric,
  route_nationale  text check (route_nationale in ('RN1','RN2','RN3')),
  type_livraison   text check (type_livraison in ('standard','express')),
  tarif            numeric,
  statut           text default 'en_attente' check (statut in ('en_attente','pris_en_charge','en_transit','livre','echec')),
  statut_paiement  text default 'en_attente' check (statut_paiement in ('en_attente','paye','echec')),
  qr_code          text,
  created_at       timestamptz default now(),
  updated_at       timestamptz
);

-- ── Positions GPS ────────────────────────────────────────────
create table if not exists positions_gps (
  id         bigint generated always as identity primary key,
  colis_id   uuid references colis(id) on delete cascade,
  latitude   numeric not null,
  longitude  numeric not null,
  timestamp  timestamptz not null,
  source     text default 'http' check (source in ('http','sms')),
  created_at timestamptz default now()
);
create index if not exists idx_positions_colis_ts on positions_gps(colis_id, timestamp desc);

-- ── Zones sans signal ────────────────────────────────────────
create table if not exists zones_sans_signal (
  id              bigint generated always as identity primary key,
  colis_id        uuid references colis(id) on delete cascade,
  debut           timestamptz not null,
  fin             timestamptz not null,
  duree_secondes  integer,
  lat_debut       numeric,
  lng_debut       numeric,
  lat_fin         numeric,
  lng_fin         numeric,
  created_at      timestamptz default now()
);

-- ── Transactions de paiement ─────────────────────────────────
create table if not exists transactions (
  id             bigint generated always as identity primary key,
  commande_id    uuid references colis(id),
  montant        numeric not null,
  provider       text not null,
  statut         text default 'en_attente' check (statut in ('en_attente','paye','echec')),
  transaction_id text,
  payload        text,
  created_at     timestamptz default now()
);

-- ── Notifications ────────────────────────────────────────────
create table if not exists notifications (
  id              bigint generated always as identity primary key,
  utilisateur_id  uuid references utilisateurs(id) on delete cascade,
  titre           text not null,
  corps           text not null,
  donnees         text,
  lue             boolean default false,
  created_at      timestamptz default now()
);
create index if not exists idx_notifs_user on notifications(utilisateur_id, created_at desc);
