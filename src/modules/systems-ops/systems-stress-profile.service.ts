import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { mapEndpoint, mapStressProfile } from './systems-ops.mapper.js';
import { SystemsListQueryDto, SystemsStressProfileQueryDto, UpsertStressProfileDto } from './systems-ops.schemas.js';
import { actorId } from '../../common/utils/auth/actor.util.js';
import { SystemsCatalogRepository } from './systems-catalog.repository.js';
import { SystemsStressProfileRepository } from './systems-stress-profile.repository.js';

function stressCode(endpointCode: string, bodyCode?: string): string {
  return bodyCode ?? `STRESS_${endpointCode}`.slice(0, 180);
}

@Injectable()
export class SystemsStressProfileService {
  constructor(
    private readonly catalogRepository: SystemsCatalogRepository,
    private readonly stressRepository: SystemsStressProfileRepository,
  ) {}

  async listStressProfiles(query: SystemsStressProfileQueryDto) {
    const result = await this.stressRepository.listStressProfiles(query);
    return { items: result.rows.map(mapStressProfile), meta: result.meta };
  }

  async getStressProfile(profileId: string) {
    const row = await this.stressRepository.findStressProfileById(profileId);
    if (!row) throw new NotFoundException('SYSTEM_STRESS_PROFILE_NOT_FOUND');
    return mapStressProfile(row);
  }

  async upsertStressProfile(body: UpsertStressProfileDto, user: AuthenticatedUser) {
    const endpoint = await this.catalogRepository.findEndpointById(body.endpointId);
    if (!endpoint) throw new NotFoundException('SYSTEM_ENDPOINT_NOT_FOUND');
    const row = await this.stressRepository.upsertStressProfile({
      ...body,
      code: stressCode(endpoint.code, body.code),
      actorId: actorId(user),
    });
    return mapStressProfile(row);
  }

  async getStressMatrix(query: SystemsListQueryDto) {
    const result = await this.stressRepository.listStressRequiredEndpoints(query);
    const endpointIds = result.rows.map((endpoint) => String(endpoint.id));
    const profiles = await this.stressRepository.findStressProfilesByEndpointIds(endpointIds);
    const profilesByEndpoint = new Map<string, ReturnType<typeof mapStressProfile>[]>();

    for (const profile of profiles) {
      const key = String(profile.endpointId);
      const list = profilesByEndpoint.get(key) ?? [];
      list.push(mapStressProfile(profile));
      profilesByEndpoint.set(key, list);
    }

    return {
      items: result.rows.map((endpoint) => {
        const endpointProfiles = profilesByEndpoint.get(String(endpoint.id)) ?? [];
        return {
          endpoint: mapEndpoint(endpoint),
          profiles: endpointProfiles,
          hasEnabledProfile: endpointProfiles.some((profile) => profile.isEnabled),
        };
      }),
      meta: result.meta,
    };
  }
}
