import { Module } from '@nestjs/common';
import { EquivalencesController } from './equivalences.controller';
import { EquivalencesService } from './equivalences.service';
import { ProductCommandsService } from './product-commands.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { StockMovementService } from './stock-movement.service';
import { StockQueriesService } from './stock-queries.service';
import { StorageService } from '../../common/storage/storage.service';
import { UploadsController } from './uploads.controller';

@Module({
  controllers: [ProductsController, EquivalencesController, UploadsController],
  providers: [ProductsService, ProductCommandsService, EquivalencesService, StockQueriesService, StockMovementService, StorageService],
})
export class InventoryModule {}
