import { Module } from '@nestjs/common';
import { ResilienceModule } from '../../common/resilience/resilience.module.js';
import { MailSenderClient } from './mail-sender.client.js';
import { MailSenderService } from './mail-sender.service.js';

@Module({
  imports: [ResilienceModule],
  providers: [MailSenderClient, MailSenderService],
  exports: [MailSenderService],
})
export class MailSenderModule {}
