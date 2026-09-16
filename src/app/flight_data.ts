/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FlightOption } from './types.ts';

/**
 * Resolves a flight the way a model is likely to name it: by id (`SB-101`), by
 * flight number (`SB 101`), or either with spacing/case/punctuation drift.
 */
export function findFlight(reference: string): FlightOption | undefined {
  const normalize = (value: string) => value.toLowerCase().replace(/[\s-]/g, '');
  const needle = normalize(reference ?? '');
  if (!needle) return undefined;
  return FLIGHT_DATABASE.find(
    (f) => normalize(f.id) === needle || normalize(f.flightNumber) === needle
  );
}

export const FLIGHT_DATABASE: FlightOption[] = [
  {
    id: 'SB-101',
    airline: 'SkyBreeze Airways',
    flightNumber: 'SB 101',
    origin: 'SFO',
    originCity: 'San Francisco',
    destination: 'HND',
    destinationCity: 'Tokyo',
    departureTime: '11:15 AM',
    arrivalTime: '03:45 PM (+1)',
    duration: '11h 30m',
    cabinClass: 'Economy',
    priceUsd: 780,
    availableSeats: 14,
    aircraft: 'Boeing 787-9 Dreamliner',
  },
  {
    id: 'SB-102',
    airline: 'SkyBreeze Airways',
    flightNumber: 'SB 102',
    origin: 'SFO',
    originCity: 'San Francisco',
    destination: 'HND',
    destinationCity: 'Tokyo',
    departureTime: '01:30 PM',
    arrivalTime: '06:10 PM (+1)',
    duration: '11h 40m',
    cabinClass: 'Premium Economy',
    priceUsd: 1420,
    availableSeats: 6,
    aircraft: 'Airbus A350-1000',
  },
  {
    id: 'SB-103',
    airline: 'SkyBreeze Express',
    flightNumber: 'SB 103',
    origin: 'SFO',
    originCity: 'San Francisco',
    destination: 'HND',
    destinationCity: 'Tokyo',
    departureTime: '09:00 PM',
    arrivalTime: '01:15 AM (+2)',
    duration: '11h 15m',
    cabinClass: 'Business',
    priceUsd: 3650,
    availableSeats: 4,
    aircraft: 'Boeing 777-300ER',
  },
  {
    id: 'SB-201',
    airline: 'SkyBreeze Airways',
    flightNumber: 'SB 201',
    origin: 'SFO',
    originCity: 'San Francisco',
    destination: 'LHR',
    destinationCity: 'London',
    departureTime: '04:45 PM',
    arrivalTime: '11:20 AM (+1)',
    duration: '10h 35m',
    cabinClass: 'Economy',
    priceUsd: 690,
    availableSeats: 22,
    aircraft: 'Airbus A350-900',
  },
  {
    id: 'SB-202',
    airline: 'SkyBreeze Airways',
    flightNumber: 'SB 202',
    origin: 'SFO',
    originCity: 'San Francisco',
    destination: 'LHR',
    destinationCity: 'London',
    departureTime: '07:10 PM',
    arrivalTime: '01:40 PM (+1)',
    duration: '10h 30m',
    cabinClass: 'Business',
    priceUsd: 3100,
    availableSeats: 5,
    aircraft: 'Boeing 787-10',
  },
  {
    id: 'SB-301',
    airline: 'SkyBreeze Airways',
    flightNumber: 'SB 301',
    origin: 'JFK',
    originCity: 'New York',
    destination: 'CDG',
    destinationCity: 'Paris',
    departureTime: '06:30 PM',
    arrivalTime: '07:55 AM (+1)',
    duration: '7h 25m',
    cabinClass: 'Economy',
    priceUsd: 540,
    availableSeats: 18,
    aircraft: 'Boeing 787-9',
  },
  {
    id: 'SB-302',
    airline: 'SkyBreeze Airways',
    flightNumber: 'SB 302',
    origin: 'JFK',
    originCity: 'New York',
    destination: 'CDG',
    destinationCity: 'Paris',
    departureTime: '09:15 PM',
    arrivalTime: '10:40 AM (+1)',
    duration: '7h 25m',
    cabinClass: 'Business',
    priceUsd: 2890,
    availableSeats: 8,
    aircraft: 'Airbus A350-900',
  },
  {
    id: 'SB-401',
    airline: 'SkyBreeze Airways',
    flightNumber: 'SB 401',
    origin: 'SFO',
    originCity: 'San Francisco',
    destination: 'JFK',
    destinationCity: 'New York',
    departureTime: '08:30 AM',
    arrivalTime: '05:05 PM',
    duration: '5h 35m',
    cabinClass: 'Economy',
    priceUsd: 280,
    availableSeats: 30,
    aircraft: 'Airbus A321neo',
  },
];
