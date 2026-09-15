/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface FlightOption {
  id: string;
  airline: string;
  flightNumber: string;
  origin: string;
  originCity: string;
  destination: string;
  destinationCity: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  cabinClass: 'Economy' | 'Premium Economy' | 'Business' | 'First';
  priceUsd: number;
  availableSeats: number;
  aircraft: string;
}

export interface BookingState {
  searchQuery: {
    origin: string;
    destination: string;
    cabinClass?: string;
  };
  availableFlights: FlightOption[];
  selectedFlightId: string | null;
  amenities: {
    seatPreference: 'Window' | 'Aisle' | 'Extra Legroom Exit Row';
    mealPreference: 'Standard Gourmet' | 'Vegetarian' | 'Vegan' | 'Halal' | 'Kosher';
    extraBaggageCount: number;
  };
  passenger: {
    name: string;
    email: string;
    frequentFlyerNumber?: string;
  } | null;
  bookingStatus: 'draft' | 'flight_selected' | 'amenities_configured' | 'confirmed';
  confirmationNumber: string | null;
}
